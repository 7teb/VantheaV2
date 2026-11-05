import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { before, test } from "node:test";
import { turn_diffs } from "../electron/turn-diff/index.ts";
import * as queue from "../electron/turn-diff/queue.ts";
import { repo_with, skip_without_git, write } from "./git-kit.ts";
import { chat_dir, chats, close_turn, open_turn, roots, start_service } from "./turn-diff-service-kit.ts";

before(start_service);
const one_turn = { kind: "turn" as const, from_id: "t1", to_id: "t1" };

const prepare = async (source: string, targets: string[]) => {
  const root = await repo_with("fork-queue", { "a.txt": "original\n" });
  await open_turn(source, "t1", root);
  await write(root, { "a.txt": "changed\n" });
  close_turn(source, "t1");
  await queue.tail(source);
  for (const target of targets) {
    chats.set(target, [...(chats.get(source) ?? [])]);
    roots.set(target, root);
  }
};

const readable = async (target: string) => {
  const diff = await turn_diffs.file(target, one_turn, "a.txt");
  assert.deepEqual(diff.kind === "text" && diff.lines.map((line) => line.text), ["original", "changed"]);
};

test("source removal immediately after fork waits for the not-yet-started copy", { skip: skip_without_git }, async () => {
  await prepare("queue-immediate", ["queue-immediate-fork"]);
  turn_diffs.fork("queue-immediate", "queue-immediate-fork");
  await turn_diffs.remove_chat("queue-immediate");
  chats.delete("queue-immediate");
  await queue.tail("queue-immediate-fork");
  await readable("queue-immediate-fork");
});

test("source deletion waits for every pending sibling fork", { skip: skip_without_git }, async () => {
  const source = "queue-siblings";
  const targets = ["queue-sibling-one", "queue-sibling-two", "queue-sibling-three"];
  await prepare(source, targets);
  for (const target of targets) turn_diffs.fork(source, target);
  await turn_diffs.remove_chat(source);
  chats.delete(source);
  for (const target of targets) { await queue.tail(target); await readable(target); }
});

test("deleting a pending destination does not recreate its snapshot folder", { skip: skip_without_git }, async () => {
  const source = "queue-target-delete";
  const target = "queue-target-removed";
  await prepare(source, [target]);
  turn_diffs.fork(source, target);
  await turn_diffs.remove_chat(target);
  await queue.tail(source);
  await assert.rejects(fs.stat(chat_dir(target)), { code: "ENOENT" });
  assert.ok((await fs.stat(path.join(chat_dir(source), "objects"))).isDirectory());
});
