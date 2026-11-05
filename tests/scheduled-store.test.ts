import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ScheduledTask } from "../shared/scheduled.ts";
import { chat_meta, create_chat, list_chats } from "../electron/chats/store.ts";
import { change_task, create_task } from "../electron/scheduled/edit.ts";
import { drop_task, forget_scheduled_chat, load_scheduled, patch_task, put_task, scheduled_task, scheduled_tasks, scheduled_views } from "../electron/scheduled/store.ts";
import { writes_settled } from "../electron/storage/json-file.ts";
import { start_chats, start_settings, temp_root } from "./hooks-kit.ts";

let root = "";
let chat_a = "";
let chat_b = "";

const file = () => path.join(root, "scheduled-tasks.json");

const stored = (over: Record<string, unknown> = {}) => ({
  id: "task-a",
  chat_id: chat_a,
  prompt: "Check the heat in Mali",
  interval: "1h",
  enabled: true,
  choice: { model: "a/b", effort: "high", pro: false },
  mode: "auto",
  created_at: "2026-11-04T10:00:00.000Z",
  updated_at: "2026-11-04T10:00:00.000Z",
  next_run_at: "2026-11-04T11:00:00.000Z",
  last_run: null,
  runs: [],
  ...over,
});

const write_file = (tasks: unknown[]) => fs.writeFile(file(), JSON.stringify({ version: 1, tasks }));

before(async () => {
  root = await temp_root("scheduled-store");
  await start_settings(root);
  await start_chats(root);
  chat_a = (await create_chat("")).id;
  chat_b = (await create_chat("")).id;
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("a missing file loads as no tasks and writes nothing, the chats stay as they were", async () => {
  const chats = JSON.stringify(list_chats());
  await load_scheduled(file());
  assert.deepEqual(scheduled_tasks(), []);
  await assert.rejects(fs.stat(file()), /ENOENT/);
  assert.equal(JSON.stringify(list_chats()), chats);
});

test("a corrupt file is kept as a copy and loads as no tasks", async () => {
  await fs.writeFile(file(), "{ not json");
  await load_scheduled(file());
  assert.deepEqual(scheduled_tasks(), []);
  const copies = (await fs.readdir(root)).filter((name) => name.startsWith("scheduled-tasks.json.corrupt-"));
  assert.equal(copies.length, 1);
  await fs.rm(file());
});

test("invalid records are dropped, a bad mode falls back to ask and a running run becomes stopped", async () => {
  await write_file([
    stored({ mode: "yolo", last_run: { message_id: "m1", started_at: "2026-11-04T10:00:00.000Z", ended_at: null, result: null, error: null } }),
    stored({ id: "", chat_id: chat_b }),
    stored({ id: "unknown-chat", chat_id: "00000000-0000-4000-8000-000000000000" }),
    stored({ id: "bad-interval", chat_id: chat_b, interval: "5m" }),
    stored({ id: "no-model", chat_id: chat_b, choice: { effort: "high" } }),
    stored({ id: "no-prompt", chat_id: chat_b, prompt: "  " }),
  ]);
  await load_scheduled(file());
  const tasks = scheduled_tasks();
  assert.deepEqual(
    tasks.map((task) => task.id),
    ["task-a"],
  );
  const task = tasks[0] as ScheduledTask;
  assert.equal(task.mode, "ask");
  assert.equal(task.last_run?.result, "stopped");
  assert.ok(task.last_run?.ended_at);
  assert.deepEqual(
    task.runs.map((mark) => mark.result),
    ["stopped"],
  );
  await writes_settled(file());
  const rewritten = JSON.parse(await fs.readFile(file(), "utf8"));
  assert.equal(rewritten.tasks.length, 1);
  assert.equal(rewritten.tasks[0].last_run.result, "stopped");
});

test("a saved task loads back unchanged and its view takes name and project from the chat", async () => {
  await write_file([]);
  await load_scheduled(file());
  const task = stored({ id: "round-trip", chat_id: chat_b, runs: [{ started_at: "2026-11-04T10:00:00.000Z", result: "quiet" }] }) as ScheduledTask;
  put_task(task);
  await writes_settled(file());
  await load_scheduled(file());
  assert.deepEqual(scheduled_tasks(), [task]);
  const [view] = scheduled_views();
  assert.equal(view?.name, "");
  assert.equal(view?.project_path, "");
  assert.equal(view?.running, false);
});

test("removing a task chat removes its task", async () => {
  await write_file([stored({ id: "gone", chat_id: chat_a })]);
  await load_scheduled(file());
  forget_scheduled_chat(chat_a);
  assert.deepEqual(scheduled_tasks(), []);
  await writes_settled(file());
  assert.deepEqual(JSON.parse(await fs.readFile(file(), "utf8")).tasks, []);
});

test("a second stored task for a chat that already has one is dropped", async () => {
  await write_file([stored({ id: "first", chat_id: chat_b }), stored({ id: "second", chat_id: chat_b })]);
  await load_scheduled(file());
  assert.deepEqual(
    scheduled_tasks().map((task) => task.id),
    ["first"],
  );
  await writes_settled(file());
  assert.deepEqual(
    JSON.parse(await fs.readFile(file(), "utf8")).tasks.map((task: { id: string }) => task.id),
    ["first"],
  );
});

test("a rename keeps a run end recorded while the title is saved and never brings back a task deleted meanwhile", async () => {
  await write_file([]);
  await load_scheduled(file());
  const task = await create_task({ name: "Heat", prompt: "Check the heat in Mali", interval: "1h", enabled: true, choice: { model: "a/b", effort: "high", pro: false }, mode: "auto", project_path: "" });
  const started_at = "2026-11-04T10:00:00.000Z";
  patch_task(task.id, (current) => ({ ...current, last_run: { message_id: "m1", started_at, ended_at: null, result: null, error: null } }));
  const renaming = change_task(task.id, { name: "Heat watch" });
  patch_task(task.id, (current) => ({
    ...current,
    last_run: { message_id: "m1", started_at, ended_at: "2026-11-04T10:01:00.000Z", result: "quiet", error: null },
    runs: [{ started_at, result: "quiet" }],
    next_run_at: "2026-11-04T11:00:00.000Z",
  }));
  const renamed = await renaming;
  assert.equal(renamed.last_run?.result, "quiet");
  assert.deepEqual(scheduled_task(task.id)?.runs, [{ started_at, result: "quiet" }]);
  assert.equal(scheduled_task(task.id)?.next_run_at, "2026-11-04T11:00:00.000Z");
  assert.equal(chat_meta(task.chat_id)?.title, "Heat watch");
  const deleted = change_task(task.id, { name: "Heat again" });
  drop_task(task.id);
  await assert.rejects(deleted, /was deleted while it was being changed/);
  assert.equal(scheduled_task(task.id), null);
});
