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

test("reciprocal and chained fork queues finish without a dependency cycle", { skip: skip_without_git }, async () => {
  const root = await repo_with("fork-queue", { "a.txt": "base\n" });
  await open_turn("queue-left", "q1", root);
  await write(root, { "a.txt": "edited\n" });
  close_turn("queue-left", "q1");
  await queue.tail("queue-left");
  for (const id of ["queue-right", "queue-third"]) {
    chats.set(id, [...(chats.get("queue-left") ?? [])]);
    roots.set(id, root);
  }
  turn_diffs.fork("queue-left", "queue-right");
  turn_diffs.fork("queue-right", "queue-left");
  turn_diffs.fork("queue-left", "queue-third");
  await Promise.all([queue.tail("queue-left"), queue.tail("queue-right"), queue.tail("queue-third")]);
  await turn_diffs.remove_chat("queue-left");
  await turn_diffs.remove_chat("queue-right");
  const diff = await turn_diffs.file("queue-third", { kind: "turn", from_id: "q1", to_id: "q1" }, "a.txt");
  assert.deepEqual(diff.kind === "text" && diff.lines.map((line) => line.text), ["base", "edited"]);
});

test("deleting a source while a fork copies its packed objects preserves the fork", { skip: skip_without_git }, async (t) => {
  const root = await repo_with("fork-delete", { "a.txt": "original\n" });
  const source = "review-source";
  const target = "review-fork";
  await open_turn(source, "t1", root);
  await write(root, { "a.txt": "changed\n" });
  close_turn(source, "t1");
  await queue.tail(source);
  const objects = path.join(chat_dir(source), "objects");
  const loose: { file: string; oid: string }[] = [];
  for (const folder of await fs.readdir(objects)) {
    if (!/^[a-f0-9]{2}$/.test(folder)) continue;
    for (const name of await fs.readdir(path.join(objects, folder))) loose.push({ file: path.join(objects, folder, name), oid: folder + name });
  }
  const pack = path.join(objects, "pack");
  await fs.mkdir(pack, { recursive: true });
  execFileSync(tool().exe, ["pack-objects", path.join(pack, "pack")], { cwd: root, input: loose.map((entry) => entry.oid).join("\n") + "\n", env: { ...process.env, GIT_OBJECT_DIRECTORY: objects, GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(root, ".git", "objects") } });
  for (const entry of loose) await fs.unlink(entry.file);
  chats.set(target, [...(chats.get(source) ?? [])]);
  roots.set(target, root);
  let enter = () => {};
  let release = () => {};
  let deleted = () => {};
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const paused = new Promise<void>((resolve) => { release = resolve; });
  const removed = new Promise<void>((resolve) => { deleted = resolve; });
  const original_link = fs.link.bind(fs);
  const original_rm = fs.rm.bind(fs);
  t.mock.method(fs, "link", async (from: Parameters<typeof fs.link>[0], to: Parameters<typeof fs.link>[1]) => {
    if (path.dirname(String(from)) === pack) { enter(); await paused; }
    return original_link(from, to);
  });
  t.mock.method(fs, "rm", async (file: Parameters<typeof fs.rm>[0], options: Parameters<typeof fs.rm>[1]) => {
    await original_rm(file, options);
    if (String(file) === chat_dir(source)) deleted();
  });
  turn_diffs.fork(source, target);
  await entered;
  const deleting = turn_diffs.remove_chat(source);
  await Promise.race([removed, new Promise((resolve) => setTimeout(resolve, 150))]);
  release();
  await deleting;
  await queue.tail(target);
  chats.delete(source);
  const diff = await turn_diffs.file(target, { kind: "turn", from_id: "t1", to_id: "t1" }, "a.txt");
  assert.deepEqual(diff.kind === "text" && diff.lines.map((line) => line.text), ["original", "changed"]);
});
