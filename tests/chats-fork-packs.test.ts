import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { before, test } from "node:test";
import { turn_diffs } from "../electron/turn-diff/index.ts";
import * as queue from "../electron/turn-diff/queue.ts";
import { repo_with, skip_without_git, tool, write } from "./git-kit.ts";
import { chat_dir, chats, close_turn, open_turn, roots, start_service } from "./turn-diff-service-kit.ts";

before(start_service);
const one_turn = { kind: "turn" as const, from_id: "t1", to_id: "t1" };

const pack_objects = async (root: string, chat_id: string) => {
  const objects = path.join(chat_dir(chat_id), "objects");
  const loose: { file: string; oid: string }[] = [];
  for (const folder of await fs.readdir(objects)) {
    if (!/^[a-f0-9]{2}$/.test(folder)) continue;
    for (const name of await fs.readdir(path.join(objects, folder))) loose.push({ file: path.join(objects, folder, name), oid: folder + name });
  }
  assert.ok(loose.length > 0);
  const pack = path.join(objects, "pack");
  await fs.mkdir(pack, { recursive: true });
  execFileSync(tool().exe, ["pack-objects", path.join(pack, "pack")], { cwd: root, input: loose.map((entry) => entry.oid).join("\n") + "\n", env: { ...process.env, GIT_OBJECT_DIRECTORY: objects, GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(root, ".git", "objects") } });
  for (const entry of loose) await fs.unlink(entry.file);
  return pack;
};

for (const [mixed, copy] of [[false, false], [true, false], [false, true]] as const) {
  test(`a fork retains ${mixed ? "packed and loose" : "pack-only"} snapshot objects after deleting its source${copy ? " with cross-device copy fallback" : ""}`, { skip: skip_without_git }, async (t) => {
    const root = await repo_with("fork-pack", { "a.txt": "original\n" });
    const source = mixed ? "packed-mixed" : copy ? "packed-copy" : "packed-only";
    const target = source + "-fork";
    await open_turn(source, "t1", root);
    await write(root, { "a.txt": "changed\n", "new.txt": "new snapshot content\n" });
    close_turn(source, "t1");
    await queue.tail(source);
    const pack = await pack_objects(root, source);
    const packed = await fs.readdir(pack);
    assert.ok(packed.some((name) => name.endsWith(".pack")));
    assert.ok(packed.some((name) => name.endsWith(".idx")));
    if (mixed) {
      await open_turn(source, "t2", root);
      await write(root, { "second.txt": "second turn content\n" });
      close_turn(source, "t2");
      await queue.tail(source);
    }
    chats.set(target, [...(chats.get(source) ?? [])]);
    roots.set(target, root);
    const original_link = fs.link.bind(fs);
    let fallbacks = 0;
    if (copy) t.mock.method(fs, "link", async (from: Parameters<typeof fs.link>[0], to: Parameters<typeof fs.link>[1]) => {
      if (path.dirname(String(from)) === pack) {
        fallbacks += 1;
        throw Object.assign(new Error("test cross-device link"), { code: "EXDEV" });
      }
      return original_link(from, to);
    });
    turn_diffs.fork(source, target);
    await queue.tail(target);
    for (const name of packed) {
      const retained = path.join(chat_dir(target), "objects", "pack", name);
      assert.deepEqual(await fs.readFile(retained), await fs.readFile(path.join(pack, name)));
      assert.equal((await fs.stat(retained)).nlink, copy ? 1 : 2);
    }
    if (copy) assert.equal(fallbacks, packed.length);
    await turn_diffs.remove_chat(source);
    chats.delete(source);
    const [summary] = await turn_diffs.summaries(target, [one_turn]);
    assert.equal(summary?.kind, "ready");
    assert.deepEqual(summary?.kind === "ready" && summary.entries.map((entry) => entry.path), ["a.txt", "new.txt"]);
    const diff = await turn_diffs.file(target, one_turn, "a.txt");
    assert.deepEqual(diff.kind === "text" && diff.lines.map((line) => `${line.kind} ${line.text}`), ["remove original", "add changed"]);
    assert.deepEqual((await fs.readdir(path.join(chat_dir(target), "objects", "pack"))).sort(), packed.sort());
    if (mixed) {
      const second = await turn_diffs.file(target, { kind: "turn", from_id: "t2", to_id: "t2" }, "second.txt");
      assert.deepEqual(second.kind === "text" && second.lines.map((line) => line.text), ["second turn content"]);
    }
  });
}
