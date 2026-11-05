import assert from "node:assert/strict";
import { before, test } from "node:test";
import { build, type Plugin } from "esbuild";
import { empty_composer, held_chats, type ComposerState } from "../src/state/chat-drafts.ts";

const stubs: Record<string, string> = {
  run: "export const started = []; export const start_internal_turn = async (chat_id, origin, text) => { started.push({ chat_id, origin, text }); return { user_message_id: 'u', message_id: 'm' }; };",
  manager: "export const result_was_read = () => false;",
  active: "export const user_stopped = () => false; export const is_active = () => false; export const has_steers = () => false;",
};

const notification_stubs: Plugin = {
  name: "notification-stubs",
  setup(builder) {
    builder.onResolve({ filter: /[\\/]turn[\\/]run\.ts$/ }, () => ({ path: "run", namespace: "stub" }));
    builder.onResolve({ filter: /[\\/]background[\\/]manager\.ts$/ }, () => ({ path: "manager", namespace: "stub" }));
    builder.onResolve({ filter: /[\\/]turn[\\/]active\.ts$/ }, () => ({ path: "active", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
  },
};

let notes: any;

const task = (chat_id: string, id: string) => ({
  id,
  chat_id,
  name: "tests",
  command: "npm test",
  shell: "powershell",
  cwd: ".",
  status: "completed",
  exit_code: 0,
  started_at: "2026-10-15T10:00:00.000Z",
  ended_at: "2026-10-15T10:01:00.000Z",
  output_tail: "ok",
});

const output = { text: () => "ok", tail: () => "ok", chars: () => 2, lines: () => 1 };

const settle = () => new Promise((resolve) => setImmediate(resolve));

before(async () => {
  const result = await build({
    stdin: {
      contents: ['export { hold_events_for, notify_background_finished, take_background_notes } from "./electron/app/notifications.ts";', 'export { started } from "./electron/turn/run.ts";'].join("\n"),
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [notification_stubs],
    external: ["electron"],
    logLevel: "silent",
  });
  notes = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
});

test("a chat with a queued user message starts no automatic turn until the composer releases it", async () => {
  notes.started.length = 0;
  notes.hold_events_for("window", ["c1"]);
  notes.notify_background_finished(task("c1", "t1"), output);
  await settle();
  assert.deepEqual(notes.started, []);
  notes.hold_events_for("window", []);
  await settle();
  assert.deepEqual(notes.started.map((entry: { chat_id: string; origin: string }) => [entry.chat_id, entry.origin]), [["c1", "background"]]);
});

test("a chat without queued user messages continues at once while another chat stays held", async () => {
  notes.started.length = 0;
  notes.hold_events_for("window", ["c2"]);
  notes.notify_background_finished(task("c3", "t3"), output);
  notes.notify_background_finished(task("c2", "t2"), output);
  await settle();
  assert.deepEqual(notes.started.map((entry: { chat_id: string }) => entry.chat_id), ["c3"]);
  notes.hold_events_for("window", []);
  await settle();
  assert.deepEqual(notes.started.map((entry: { chat_id: string }) => entry.chat_id), ["c3", "c2"]);
});

test("a running turn takes a finished background task as a hidden note, and no extra turn starts for it", async () => {
  notes.started.length = 0;
  notes.hold_events_for("window", ["c4"]);
  notes.notify_background_finished(task("c4", "t4"), output);
  await settle();
  const taken = notes.take_background_notes("c4");
  assert.equal(taken.length, 1);
  assert.deepEqual([taken[0].kind, taken[0].notice, taken[0].content], ["notice", "background_task", taken[0].text]);
  assert.ok(taken[0].text.startsWith("[BACKGROUND TASK EVENT]\n\nThis is an internal app event, not a message written by the user. A long-running task you started earlier in this chat has finished. The user does not see this event in the chat; if its result matters to them, say it in your reply."));
  assert.deepEqual(notes.take_background_notes("c4"), []);
  notes.hold_events_for("window", []);
  await settle();
  assert.deepEqual(notes.started, []);
});

test("the composer holds a chat while it has a queued message that is not steering or while it is sending", () => {
  const queued = (steering: boolean) => ({ id: "q", text: "later", attachments: [], plan: false, steering });
  const state: ComposerState = {
    ...empty_composer,
    queues: { a: [queued(false)], b: [queued(true)], c: [] },
    sending: { d: true, e: false, a: true },
  };
  assert.deepEqual(held_chats(state), ["a", "d"]);
  assert.deepEqual(held_chats(empty_composer), []);
});
