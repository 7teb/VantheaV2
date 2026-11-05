import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { build, type Plugin } from "esbuild";
import { no_new_activity, type ScheduledTask } from "../shared/scheduled.ts";
import type { StreamEventBody } from "../shared/events.ts";
import type { ScriptedRun } from "./scheduled-turn-stub.ts";
import { temp_root } from "./hooks-kit.ts";

const stub_files: Plugin = {
  name: "scheduled-stubs",
  setup(builder) {
    builder.onResolve({ filter: /[\\/]turn[\\/]run\.ts$/ }, () => ({ path: path.resolve("tests/scheduled-turn-stub.ts") }));
    builder.onResolve({ filter: /toast\.ts$/ }, (args) =>
      /[\\/]scheduled[\\/]/.test(args.path) || /[\\/]scheduled[\\/]run\.ts$/.test(args.importer) ? { path: path.resolve("tests/scheduled-toast-stub.ts") } : undefined,
    );
  },
};

const entry = [
  'export { notify_run_waiting, start_task_run } from "./electron/scheduled/run.ts";',
  'export { load_scheduled, put_task, scheduled_task, drop_task, patch_task } from "./electron/scheduled/store.ts";',
  'export { chat_meta, create_chat, get_chat, init_chats, update_meta } from "./electron/chats/store.ts";',
  'export { script } from "./electron/turn/run.ts";',
  'export { toasts } from "./electron/scheduled/toast.ts";',
];

let main: any;
let root = "";

const old_time = "2026-01-01T00:00:00.000Z";

const ended: StreamEventBody = { type: "end", status: "done", error: null };

const answer = (text: string, extra: { tools?: string[]; hold?: boolean } = {}): ScriptedRun => ({ kind: "run", bodies: [{ type: "text", round: 0, delta: text }, ended], ...extra });

const quiet = answer(no_new_activity);

const failure = (message: string): ScriptedRun => ({ kind: "run", bodies: [{ type: "end", status: "failed", error: { kind: "internal", message } }] });

before(async () => {
  root = await temp_root("scheduled-run");
  const result = await build({
    stdin: { contents: entry.join("\n"), resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [stub_files],
    external: ["electron"],
    logLevel: "silent",
  });
  main = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
  await main.init_chats({
    dirs: { index_file: path.join(root, "chats", "index.json"), data_dir: path.join(root, "chats", "data"), search_dir: path.join(root, "chats", "search") },
    legacy_root: path.join(root, "legacy"),
    events: { changed: () => undefined, removed: () => undefined, appended: () => undefined, truncated: () => undefined, questions: () => undefined },
  });
});

beforeEach(async () => {
  await main.load_scheduled(path.join(root, `scheduled-${Date.now()}-${Math.random()}.json`));
  main.script.next = [];
  main.script.calls = [];
  main.toasts.length = 0;
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const make_task = async (over: Partial<ScheduledTask> = {}): Promise<ScheduledTask> => {
  const chat = await main.create_chat("");
  await main.update_meta(chat.id, { title: "Africa heat", updated_at: old_time });
  const task: ScheduledTask = {
    id: `task-${Math.random()}`,
    chat_id: chat.id,
    prompt: "Check how hot it gets in Africa",
    interval: "1h",
    enabled: true,
    choice: { model: "test/model", effort: "high", pro: true },
    mode: "auto",
    created_at: old_time,
    updated_at: old_time,
    next_run_at: old_time,
    last_run: null,
    runs: [],
    ...over,
  };
  main.put_task(task);
  return task;
};

const run = async (task: ScheduledTask, step: ScriptedRun, kind: "schedule" | "manual" = "schedule") => {
  main.script.next.push(step);
  const start = await main.start_task_run(task.id, kind);
  await start?.settled;
  return start;
};

const assistant_of = async (chat_id: string, message_id: string | null | undefined) => (await main.get_chat(chat_id))?.messages.find((message: { id: string }) => message.id === message_id);

test("a run starts in the task chat with origin scheduled, the task prompt, choice and mode, and keeps the chat order", async () => {
  const task = await make_task();
  await run(task, answer("Mali hit 48 C.", { tools: ["web_search"] }));
  const call = main.script.calls[0];
  assert.equal(call.chat_id, task.chat_id);
  assert.equal(call.origin, "scheduled");
  assert.equal(call.text, task.prompt);
  assert.deepEqual(call.turn.choice, task.choice);
  assert.equal(call.turn.mode, "auto");
  assert.equal(call.turn.keep_order, true);
  assert.equal(call.notes.length, 1);
  assert.equal(call.notes[0].notice, "scheduled_run");
  assert.match(call.notes[0].content, /This is the first run of this task/);
  assert.match(call.notes[0].content, /Look things up with web_search/);

  await run(task, answer(no_new_activity, { tools: ["browser_navigate"] }));
  const second = main.script.calls[1];
  assert.match(second.notes[0].content, /Compare what you find with the answers of the earlier runs/);
  assert.match(second.notes[0].content, /Web search is not configured in this app/);
});

test("a quiet run records quiet, marks the end quiet and neither notifies nor moves the chat", async () => {
  const task = await make_task();
  await run(task, quiet);
  const stored = main.scheduled_task(task.id);
  assert.equal(stored.last_run.result, "quiet");
  assert.ok(stored.last_run.ended_at);
  assert.deepEqual(stored.runs.map((mark: { result: string }) => mark.result), ["quiet"]);
  assert.equal((await assistant_of(task.chat_id, stored.last_run.message_id))?.quiet, true);
  assert.equal(main.toasts.length, 0);
  assert.equal(main.chat_meta(task.chat_id).updated_at, old_time);
});

test("new activity notifies once with the answer and moves the chat up", async () => {
  const task = await make_task();
  await run(task, answer("**New** record in Mali\nDetails follow."));
  assert.equal(main.scheduled_task(task.id).last_run.result, "new");
  assert.deepEqual(main.toasts.map((toast: { kind: string }) => toast.kind), ["new"]);
  assert.equal(main.toasts[0].text, "**New** record in Mali\nDetails follow.");
  assert.equal(main.toasts[0].target.name, "Africa heat");
  assert.notEqual(main.chat_meta(task.chat_id).updated_at, old_time);
  assert.equal((await assistant_of(task.chat_id, main.scheduled_task(task.id).last_run.message_id))?.quiet, undefined);
});

test("failures notify once per streak, a start failure after a success notifies again", async () => {
  const task = await make_task();
  await run(task, failure("provider down"));
  await run(task, failure("provider still down"));
  assert.deepEqual(main.toasts.map((toast: { text: string }) => toast.text), ["provider down"]);
  assert.equal((await assistant_of(task.chat_id, main.scheduled_task(task.id).last_run.message_id))?.quiet, true);
  await run(task, quiet);
  assert.equal(await run(task, { kind: "throw", message: "model test/model is not in the catalog" }), null);
  const stored = main.scheduled_task(task.id);
  assert.equal(stored.last_run.result, "failed");
  assert.equal(stored.last_run.message_id, null);
  assert.equal(stored.last_run.error, "model test/model is not in the catalog");
  assert.deepEqual(main.toasts.map((toast: { text: string }) => toast.text), ["provider down", "model test/model is not in the catalog"]);
  assert.deepEqual(stored.runs.map((mark: { result: string }) => mark.result), ["failed", "failed", "quiet", "failed"]);
});

test("a busy chat skips a scheduled run silently and refuses a manual one", async () => {
  const task = await make_task();
  assert.equal(await run(task, { kind: "busy" }), null);
  assert.equal(main.scheduled_task(task.id).last_run, null);
  main.script.next.push({ kind: "busy" });
  await assert.rejects(main.start_task_run(task.id, "manual"), /^Error: the task chat has a turn running$/);
  assert.equal(main.toasts.length, 0);
});

test("a task deleted during its run ends without a record and without a notification", async () => {
  const task = await make_task();
  main.script.next.push(answer("Something new.", { hold: true }));
  const start = await main.start_task_run(task.id, "schedule");
  assert.equal(main.scheduled_task(task.id).last_run.result, null);
  main.drop_task(task.id);
  main.script.release();
  await start.settled;
  assert.equal(main.scheduled_task(task.id), null);
  assert.equal(main.toasts.length, 0);
});

test("an approval card in a running run notifies once per card, also for its sub-agents, and not after the run", async () => {
  const task = await make_task();
  const request = { kind: "memory", action: "remember", text: "x" };
  main.script.next.push({
    kind: "run",
    hold: true,
    bodies: [
      { type: "tool_approval", call_id: "c1", request },
      { type: "tool_approval", call_id: "c1", request },
      { type: "tool_approval", call_id: "c2", request },
      { type: "text", round: 0, delta: no_new_activity },
      ended,
    ],
  });
  const start = await main.start_task_run(task.id, "schedule");
  main.notify_run_waiting(task.chat_id, "run-1:c9");
  main.notify_run_waiting(task.chat_id, "run-1:c9");
  main.script.release();
  await start.settled;
  main.notify_run_waiting(task.chat_id, "run-1:c10");
  assert.deepEqual(main.toasts.map((toast: { kind: string }) => toast.kind), ["waiting", "waiting", "waiting"]);
});

test("an earlier completion preserves the later run and its waiting notifications", async () => {
  const task = await make_task();
  main.script.next.push(answer("earlier result", { hold: true }));
  const first = await main.start_task_run(task.id, "schedule");
  const release_first = main.script.release;
  main.script.next.push(answer("later result", { hold: true }));
  const second = await main.start_task_run(task.id, "schedule");
  const release_second = main.script.release;
  const later = { ...main.scheduled_task(task.id).last_run };
  release_first();
  await first.settled;
  assert.deepEqual(main.scheduled_task(task.id).last_run, later);
  main.notify_run_waiting(task.chat_id, "new-run-card");
  assert.equal(main.toasts.at(-1)?.kind, "waiting");
  release_second();
  await second.settled;
  assert.equal(main.scheduled_task(task.id).last_run.message_id, later.message_id);
  assert.equal(main.scheduled_task(task.id).runs.length, 2);
});

test("independent completion order 2 then 3 then 1 preserves the latest run and unrelated edits", async () => {
  const task = await make_task();
  main.script.next.push(answer("first result", { hold: true }));
  const first = await main.start_task_run(task.id, "schedule");
  const first_release = main.script.release;
  main.script.next.push(answer("second result", { hold: true }));
  const second = await main.start_task_run(task.id, "schedule");
  const second_release = main.script.release;
  main.patch_task(task.id, (current: ScheduledTask) => ({ ...current, enabled: false, next_run_at: "2030-01-01T00:00:00.000Z" }));
  main.script.next.push(answer("third result", { hold: true }));
  const third = await main.start_task_run(task.id, "manual");
  const third_release = main.script.release;
  const active = main.scheduled_task(task.id).last_run.message_id;
  second_release();
  await second.settled;
  assert.equal(main.scheduled_task(task.id).last_run.message_id, active);
  assert.equal(main.scheduled_task(task.id).last_run.result, null);
  main.notify_run_waiting(task.chat_id, "third-card");
  assert.equal(main.toasts.at(-1)?.kind, "waiting");
  third_release();
  await third.settled;
  const completed = { ...main.scheduled_task(task.id).last_run };
  first_release();
  await first.settled;
  const stored = main.scheduled_task(task.id);
  assert.deepEqual(stored.last_run, completed);
  assert.equal(stored.enabled, false);
  assert.equal(stored.next_run_at, "2030-01-01T00:00:00.000Z");
  assert.equal(stored.runs.length, 3);
});
