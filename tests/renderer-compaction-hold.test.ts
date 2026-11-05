import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import type { AssistantMessage, Chat } from "../shared/chat.ts";

type Listener = (payload: unknown) => void;

const listeners = new Map<string, Set<Listener>>();
const calls: { name: string; args: unknown[] }[] = [];
let compact_result: Promise<unknown> = Promise.resolve({ status: "done" });
let client: any;
let stop_view: (() => void) | undefined;
let stop_composer: (() => void) | undefined;
const globals = ["window", "document", "localStorage"];
const descriptors = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));

const compacting_message: AssistantMessage = {
  id: "m1",
  role: "assistant",
  model: "m",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-12T00:00:00.000Z",
  ended_at: null,
  status: "streaming",
  steps: [{ id: "compaction:0", round: 0, kind: "compaction", status: "running", source: "manual", started_at: 1 }],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 1,
};

const seed = () => {
  calls.length = 0;
  const chat: Chat = {
    id: "c1", title: "Fixture", project_path: "", workspace: "", pinned: false, created_at: "2026-10-12T00:00:00.000Z",
    updated_at: "2026-10-12T00:00:00.000Z", message_count: 1, streaming: true, summary: null, messages: [compacting_message], questions: {},
  };
  client.chat_view_store.set(client.finish_load(client.begin_load(client.empty_chat_view, "c1"), "c1", chat));
  client.composer_store.set(client.empty_composer);
  client.settings_store.set({ model: "m", effort: "high", mode: "auto" });
};

const settle = async () => {
  for (let index = 0; index < 10; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

const named = (name: string) => calls.filter((call) => call.name === name);

const pending_compaction = () => {
  let finish: (status: string) => void = () => undefined;
  compact_result = new Promise((resolve) => {
    finish = (status) => resolve({ status });
  });
  return (status: string) => finish(status);
};

before(async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { lang: "en" }, visibilityState: "hidden", addEventListener: () => undefined, removeEventListener: () => undefined } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    innerWidth: 1440, matchMedia: () => ({ matches: false, addEventListener: () => {} }), setTimeout, clearTimeout,
    vx: {
      invoke: async (name: string, ...args: unknown[]) => {
        calls.push({ name, args });
        if (name === "turn:compact") return compact_result;
        if (name === "turn:steer") return "m1";
        if (name === "turn:send") return { user_message_id: "u2", message_id: "m2" };
        if (name === "turn:context") return { used: 0, limit: 1000000 };
        return undefined;
      },
      on: (name: string, listener: Listener) => {
        const group = listeners.get(name) ?? new Set<Listener>();
        listeners.set(name, group);
        group.add(listener);
        return () => group.delete(listener);
      },
      send: () => undefined,
    },
  } });
  const entry = [
    'export { compact_now, composer_store, init_composer, set_draft_text, steer_queued, submit } from "./src/state/composer.ts";',
    'export { settings_store } from "./src/state/settings.ts";',
    'export { chat_view_store, init_chat_view } from "./src/state/chat-view.ts";',
    'export { empty_composer, draft_of, queue_of } from "./src/state/chat-drafts.ts";',
    'export { empty_chat_view, begin_load, finish_load } from "./src/state/chat-view-reduce.ts";',
  ].join("\n");
  const result = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "browser", format: "esm", write: false, define: { "process.env.NODE_ENV": '"production"' }, legalComments: "none", logLevel: "silent" });
  client = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
  stop_view = client.init_chat_view();
  stop_composer = client.init_composer();
});

after(() => {
  stop_composer?.();
  stop_view?.();
  for (const name of globals) {
    const descriptor = descriptors.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

const queued = () => client.queue_of(client.composer_store.get(), "c1").map((entry: { text: string; after_compaction?: boolean }) => [entry.text, Boolean(entry.after_compaction)]);

test("a message sent during a manual compaction waits in the queue, is never steered into it, and starts the normal answer once it is done", async () => {
  seed();
  const finish = pending_compaction();
  const compacting = client.compact_now("c1");
  client.set_draft_text("c1", "next question");
  await client.submit("c1", "");
  assert.equal(client.draft_of(client.composer_store.get(), "c1").text, "");
  assert.deepEqual(queued(), [["next question", true]]);
  assert.equal(named("turn:steer").length, 0);
  assert.equal(named("turn:send").length, 0);
  finish("done");
  assert.equal(await compacting, "done");
  await settle();
  assert.deepEqual(named("turn:send").map((call) => (call.args[0] as { text: string }).text), ["next question"]);
  assert.deepEqual(queued(), []);
  assert.equal(client.composer_store.get().compacting.c1, undefined);
});

test("after a compaction that failed for good the held message is still sent, later ones wait in the queue", async () => {
  seed();
  const finish = pending_compaction();
  const compacting = client.compact_now("c1");
  client.set_draft_text("c1", "first");
  await client.submit("c1", "");
  client.set_draft_text("c1", "second");
  await client.submit("c1", "");
  finish("failed");
  await compacting;
  await settle();
  assert.deepEqual(named("turn:send").map((call) => (call.args[0] as { text: string }).text), ["first"]);
  assert.deepEqual(queued(), [["second", false]]);
});

test("Steer on a queued message during a manual compaction marks it to send right after the compaction", async () => {
  seed();
  client.composer_store.set({ ...client.empty_composer, queues: { c1: [{ id: "q1", text: "queued", attachments: [], plan: false, steering: false }] } });
  const finish = pending_compaction();
  const compacting = client.compact_now("c1");
  await client.steer_queued("c1", "q1");
  assert.equal(named("turn:steer").length, 0);
  assert.deepEqual(queued(), [["queued", true]]);
  finish("done");
  await compacting;
  await settle();
  assert.deepEqual(named("turn:send").map((call) => (call.args[0] as { text: string }).text), ["queued"]);
});
