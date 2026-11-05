import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { before, test } from "node:test";
import type { DiffSummary } from "../shared/turn-diff.ts";
import { turn_diffs } from "../electron/turn-diff/index.ts";
import * as queue from "../electron/turn-diff/queue.ts";
import { git, scratch, skip_without_git, write } from "./git-kit.ts";
import { agent_write, assistant, chat_dir, chats, close_turn, open_turn, read_turns_file, roots, start_service, user } from "./turn-diff-service-kit.ts";

const options = { skip: skip_without_git };

before(start_service);

const ready = (summary: DiffSummary | undefined) => {
  if (summary?.kind !== "ready") throw new Error(`summary is ${JSON.stringify(summary)}`);
  return summary;
};

const counts = (summary: DiffSummary | undefined) => ready(summary).entries.map((entry) => [entry.path, entry.added, entry.removed]);

const one_turn = (id: string) => ({ kind: "turn" as const, from_id: id, to_id: id });

const text_lines = (diff: Awaited<ReturnType<typeof turn_diffs.file>>) => (diff.kind === "text" ? diff.lines.map((line) => `${line.kind} ${line.text}`) : [diff.kind]);

test("after the project folder is renamed, the turn, Whole chat and file diffs are read from its new place", options, async () => {
  const parent = await scratch("tds-rename");
  const old_root = path.join(parent, "proj");
  await write(old_root, { "a.txt": "a\n", "b.txt": "b\n" });
  git(old_root, "init", "-q", "-b", "main");
  git(old_root, "add", "-A");
  git(old_root, "commit", "-q", "-m", "init");
  await open_turn("svc-rename", "t1", old_root);
  await write(old_root, { "a.txt": "a2\n" });
  close_turn("svc-rename", "t1");
  await queue.tail("svc-rename");
  await fs.rm(path.join(chat_dir("svc-rename"), "summaries.json"), { force: true });
  const moved = path.join(parent, "moved");
  await fs.rename(old_root, moved);
  roots.set("svc-rename", moved);
  await write(moved, { "b.txt": "b2\n" });
  const [turn, chat] = await turn_diffs.summaries("svc-rename", [one_turn("t1"), { kind: "chat" }]);
  assert.deepEqual(counts(turn), [["a.txt", 1, 1]]);
  assert.deepEqual(counts(chat), [["a.txt", 1, 1], ["b.txt", 1, 1]]);
  assert.deepEqual(text_lines(await turn_diffs.file("svc-rename", one_turn("t1"), "a.txt")), ["remove a", "add a2"]);
  assert.deepEqual(text_lines(await turn_diffs.file("svc-rename", { kind: "chat" }, "b.txt")), ["remove b", "add b2"]);
});

test("a finished recorded turn is counted once, served from the cache, and counted again when its end is taken again", async () => {
  const folder = await scratch("tds-rec-cache");
  await write(folder, { "a.txt": "1\n" });
  await open_turn("rec-cache", "t1", folder);
  await agent_write("rec-cache", path.join(folder, "a.txt"), "2\n");
  close_turn("rec-cache", "t1");
  const [first] = await turn_diffs.summaries("rec-cache", [one_turn("t1")]);
  assert.deepEqual(counts(first), [["a.txt", 1, 1]]);
  const cached = JSON.parse(await fs.readFile(path.join(chat_dir("rec-cache"), "summaries.json"), "utf8"));
  assert.equal(Object.keys(cached.recorded).length, 1);
  await fs.writeFile(path.join(chat_dir("rec-cache"), "recorded", "t1", "0.after"), "2\nnot read again\n");
  const [second] = await turn_diffs.summaries("rec-cache", [one_turn("t1")]);
  assert.deepEqual(counts(second), [["a.txt", 1, 1]]);
  const record = (await read_turns_file("rec-cache")).turns[0];
  await write(folder, { "a.txt": "3\nfour\n" });
  turn_diffs.work_ended("rec-cache", "w-late", new Date(Date.parse(record.began_at) + 1).toISOString(), new Date(Date.now() + 1000).toISOString());
  const [third] = await turn_diffs.summaries("rec-cache", [one_turn("t1")]);
  assert.deepEqual(counts(third), [["a.txt", 2, 1]]);
  const recached = JSON.parse(await fs.readFile(path.join(chat_dir("rec-cache"), "summaries.json"), "utf8"));
  assert.deepEqual(Object.keys(recached.recorded), [`t1@${(await read_turns_file("rec-cache")).turns[0].end.at}`]);
});

test("a stored recorded file path that leaves the chat folder drops its turn record", async () => {
  const parent = await scratch("tds-escape");
  const folder = path.join(parent, "chat");
  await write(parent, { "secret.txt": "outside\n", "chat/a.txt": "a\n" });
  chats.set("rec-escape", [user("u_t1"), assistant("t1"), user("u_t2"), assistant("t2")]);
  roots.set("rec-escape", folder);
  const at = new Date().toISOString();
  const record = (message_id: string, file: string) => ({
    message_id,
    began_at: at,
    root: folder,
    mode: "recorded",
    repo: null,
    no_git: { reason: "not_repo", detail: folder },
    start: { at },
    end: null,
    closed: false,
    late: [],
    files: [{ path: file, before: null }],
  });
  await fs.mkdir(chat_dir("rec-escape"), { recursive: true });
  const stored = { version: 1, index_repo: null, turns: [record("t1", "../secret.txt"), record("t2", "a.txt")] };
  await fs.writeFile(path.join(chat_dir("rec-escape"), "turns.json"), JSON.stringify(stored));
  const [escaped, inside] = await turn_diffs.summaries("rec-escape", [one_turn("t1"), one_turn("t2")]);
  assert.deepEqual(escaped, { kind: "none" });
  assert.deepEqual(ready(inside).entries.map((entry) => [entry.path, entry.status]), [["a.txt", "added"]]);
  for (const bad of ["/secret.txt", "C:/secret.txt", "sub\\..\\..\\secret.txt", "a/../../secret.txt", "", "a//b"]) {
    await fs.writeFile(path.join(chat_dir("rec-escape"), "turns.json"), JSON.stringify({ ...stored, turns: [record("t1", bad)] }));
    assert.deepEqual(await turn_diffs.summaries("rec-escape", [one_turn("t1")]), [{ kind: "none" }], bad);
  }
});
