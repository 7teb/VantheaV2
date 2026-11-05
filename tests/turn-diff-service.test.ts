import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { before, test } from "node:test";
import type { DiffSummary } from "../shared/turn-diff.ts";
import { turn_diffs } from "../electron/turn-diff/index.ts";
import * as queue from "../electron/turn-diff/queue.ts";
import { sweep_orphans } from "../electron/turn-diff/sweep.ts";
import { repo_with, skip_without_git, write } from "./git-kit.ts";
import { assistant, changes, chat_dir, chats, close_turn, on_disk, open_turn, read_turns_file, roots, service, start_service } from "./turn-diff-service-kit.ts";

const options = { skip: skip_without_git };

before(start_service);

const ready = (summary: DiffSummary | undefined) => {
  if (summary?.kind !== "ready") throw new Error(`summary is ${JSON.stringify(summary)}`);
  return summary;
};

const paths_of = (summary: DiffSummary | undefined) => ready(summary).entries.map((entry) => entry.path);

const one_turn = (id: string) => ({ kind: "turn" as const, from_id: id, to_id: id });

const later = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

test("a git turn shows what changed on disk between its start and end snapshots, also without the file tools", options, async () => {
  const root = await repo_with("tds-basic", { "a.txt": "a\n", "b.txt": "b\n" });
  await open_turn("svc-basic", "t1", root);
  await write(root, { "a.txt": "a2\n", "c.txt": "c\n" });
  await fs.rm(path.join(root, "b.txt"));
  close_turn("svc-basic", "t1");
  const [turn, chat] = await turn_diffs.summaries("svc-basic", [one_turn("t1"), { kind: "chat" }]);
  assert.equal(ready(turn).source, "git");
  assert.equal(ready(turn).end.kind, "snapshot");
  assert.deepEqual(ready(turn).notes, []);
  assert.deepEqual(ready(turn).entries.map((entry) => [entry.path, entry.status]), [["a.txt", "modified"], ["b.txt", "deleted"], ["c.txt", "added"]]);
  assert.equal(ready(chat).end.kind, "live");
  const diff = await turn_diffs.file("svc-basic", one_turn("t1"), "a.txt");
  assert.deepEqual(diff.kind === "text" ? diff.lines.map((line) => `${line.kind} ${line.text}`) : [], ["remove a", "add a2"]);
  const cached = JSON.parse(await fs.readFile(path.join(chat_dir("svc-basic"), "summaries.json"), "utf8"));
  assert.equal(Object.keys(cached.pairs).length, 1);
  assert.ok(changes.some((change) => change.chat_id === "svc-basic"));
  assert.deepEqual(await turn_diffs.summaries("svc-basic", [one_turn("missing")]), [{ kind: "none" }]);
});

test("ready waits for the start snapshot and an aborted turn stops waiting with its reason", options, async () => {
  const root = await repo_with("tds-ready", { "a.txt": "a\n" });
  chats.set("svc-ready", [assistant("t1")]);
  const opener: { open: () => void } = { open: () => undefined };
  const gate = new Promise<void>((resolve) => {
    opener.open = resolve;
  });
  void queue.run("svc-ready", "test gate", () => gate);
  turn_diffs.begin("svc-ready", "t1", root);
  let resolved = false;
  const waiting = turn_diffs.ready("svc-ready", "t1", new AbortController().signal).then(() => {
    resolved = true;
  });
  const stopper = new AbortController();
  const stopped = turn_diffs.ready("svc-ready", "t1", stopper.signal);
  stopper.abort(new Error("the user stopped the turn"));
  await assert.rejects(stopped, /the user stopped the turn/);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(resolved, false);
  opener.open();
  await waiting;
  const stored = await read_turns_file("svc-ready");
  assert.equal(stored.turns[0].mode, "git");
  assert.match(stored.turns[0].start.tree, /^[0-9a-f]{40}$/);
  await turn_diffs.ready("svc-ready", "never-started", new AbortController().signal);
});

test("begin closes the previous record and late work only retakes the newest turn's end when it ended after that end", options, async () => {
  const root = await repo_with("tds-late", { "a.txt": "a\n" });
  await open_turn("svc-late", "t1", root);
  await write(root, { "a.txt": "a2\n" });
  close_turn("svc-late", "t1");
  await turn_diffs.summaries("svc-late", [one_turn("t1")]);
  const first = (await read_turns_file("svc-late")).turns[0];
  const emitted = changes.length;
  turn_diffs.work_ended("svc-late", "w-before", later(first.began_at, -60_000), new Date().toISOString());
  turn_diffs.work_ended("svc-late", "w-covered", later(first.began_at, 1), first.end.at);
  await turn_diffs.summaries("svc-late", [one_turn("t1")]);
  assert.deepEqual((await read_turns_file("svc-late")).turns[0].late, []);
  assert.equal((await read_turns_file("svc-late")).turns[0].end.tree, first.end.tree);
  await write(root, { "late.txt": "written by a background task\n" });
  turn_diffs.work_ended("svc-late", "w-late", later(first.began_at, 1), new Date(Date.now() + 1000).toISOString());
  const [after_retake] = await turn_diffs.summaries("svc-late", [one_turn("t1")]);
  const retaken = (await read_turns_file("svc-late")).turns[0];
  assert.deepEqual(retaken.late, ["w-late"]);
  assert.notEqual(retaken.end.tree, first.end.tree);
  assert.deepEqual(paths_of(after_retake), ["a.txt", "late.txt"]);
  assert.ok(changes.length > emitted);
  await write(root, { "late2.txt": "x\n" });
  turn_diffs.work_ended("svc-late", "w-late", later(first.began_at, 1), new Date(Date.now() + 2000).toISOString());
  await turn_diffs.summaries("svc-late", [one_turn("t1")]);
  assert.equal((await read_turns_file("svc-late")).turns[0].end.tree, retaken.end.tree);
  await open_turn("svc-late", "t2", root);
  const stored = (await read_turns_file("svc-late")).turns;
  assert.deepEqual(stored.map((record: { closed: boolean }) => record.closed), [true, false]);
  turn_diffs.work_ended("svc-late", "w-newer", later(first.began_at, 1), new Date(Date.now() + 3000).toISOString());
  await turn_diffs.summaries("svc-late", [one_turn("t1")]);
  const after_newer = (await read_turns_file("svc-late")).turns;
  assert.equal(after_newer[0].end.tree, retaken.end.tree);
  assert.deepEqual(after_newer[1].late, []);
  assert.equal(after_newer[1].end, null);
  close_turn("svc-late", "t2");
});

test("a running turn and a turn without an end snapshot compare with the folder now and say so", options, async () => {
  const root = await repo_with("tds-live", { "a.txt": "a\n" });
  await open_turn("svc-live", "t1", root);
  await write(root, { "a.txt": "a2\n" });
  const [running] = await turn_diffs.summaries("svc-live", [one_turn("t1")]);
  assert.deepEqual([ready(running).end.kind, ready(running).notes], ["live", [{ kind: "running" }]]);
  service.running = null;
  const [closed] = await turn_diffs.summaries("svc-live", [one_turn("t1")]);
  assert.deepEqual(ready(closed).notes, [{ kind: "end_missing", reason: "app_closed", detail: "" }]);
  await open_turn("svc-live", "t2", root);
  const [next] = await turn_diffs.summaries("svc-live", [one_turn("t1")]);
  assert.equal(ready(next).end.kind, "next_turn");
  assert.deepEqual(paths_of(next), ["a.txt"]);
  close_turn("svc-live", "t2");
});

test("removing a chat deletes its folder and a later end does nothing", options, async () => {
  const root = await repo_with("tds-remove", { "a.txt": "a\n" });
  await open_turn("svc-remove", "t1", root);
  await turn_diffs.remove_chat("svc-remove");
  await assert.rejects(fs.access(chat_dir("svc-remove")));
  close_turn("svc-remove", "t1");
  await queue.tail("svc-remove");
  await assert.rejects(fs.access(chat_dir("svc-remove")));
  assert.deepEqual(await turn_diffs.summaries("svc-remove", [one_turn("t1")]), [{ kind: "none" }]);
});

test("a fork gets hardlinked objects and its diffs stay readable after the source chat is removed", options, async () => {
  const root = await repo_with("tds-fork", { "a.txt": "a\n" });
  await open_turn("svc-src", "t1", root);
  await write(root, { "a.txt": "a2\n", "new.txt": "n\n" });
  close_turn("svc-src", "t1");
  await open_turn("svc-src", "t2", root);
  close_turn("svc-src", "t2");
  chats.set("svc-fork", (chats.get("svc-src") ?? []).slice(0, 2));
  roots.set("svc-fork", root);
  turn_diffs.fork("svc-src", "svc-fork");
  await queue.tail("svc-fork");
  const forked = await read_turns_file("svc-fork");
  assert.deepEqual(forked.turns.map((record: { message_id: string; closed: boolean }) => [record.message_id, record.closed]), [["t1", true]]);
  const objects = path.join(chat_dir("svc-fork"), "objects");
  const folder = (await fs.readdir(objects))[0] ?? "";
  const name = (await fs.readdir(path.join(objects, folder)))[0] ?? "";
  assert.equal((await fs.stat(path.join(objects, folder, name))).nlink, 2);
  await turn_diffs.remove_chat("svc-src");
  chats.delete("svc-src");
  const [summary] = await turn_diffs.summaries("svc-fork", [one_turn("t1")]);
  assert.deepEqual(paths_of(summary), ["a.txt", "new.txt"]);
  const diff = await turn_diffs.file("svc-fork", one_turn("t1"), "new.txt");
  assert.equal(diff.kind, "text");
});

test("a corrupt turns.json is kept as a copy and read as empty", options, async () => {
  const dir = chat_dir("svc-corrupt");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "turns.json"), "{ not json");
  chats.set("svc-corrupt", []);
  assert.deepEqual(await turn_diffs.summaries("svc-corrupt", [{ kind: "chat" }]), [{ kind: "none" }]);
  const names = await fs.readdir(dir);
  assert.ok(names.some((entry) => entry.startsWith("turns.json.corrupt-")));
  const root = await repo_with("tds-corrupt", { "a.txt": "a\n" });
  await open_turn("svc-corrupt", "t1", root);
  close_turn("svc-corrupt", "t1");
  await queue.tail("svc-corrupt");
  assert.equal((await read_turns_file("svc-corrupt")).turns.length, 1);
});

test("the startup sweep removes folders of unknown chats and keeps known ones, chats stored only on disk and other names", async () => {
  for (const name of ["svc-orphan", "svc-known", "svc-disk-only", "not a chat id"]) await fs.mkdir(path.join(service.root, name), { recursive: true });
  chats.set("svc-known", []);
  on_disk.add("svc-disk-only");
  assert.ok((await sweep_orphans()) >= 1);
  const names = await fs.readdir(service.root);
  assert.equal(names.includes("svc-orphan"), false);
  for (const kept of ["svc-known", "svc-disk-only", "not a chat id"]) assert.ok(names.includes(kept), kept);
});
