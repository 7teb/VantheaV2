import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import type { Chat, AssistantMessage } from "../shared/chat.ts";
import type { TurnEvent } from "../shared/events.ts";

type Listener = (payload: unknown) => void;

const listeners = new Map<string, Set<Listener>>();
const calls: { name: string; args: unknown[] }[] = [];
let steer_result: Promise<string | null> = Promise.resolve("m1");
let send_result: Promise<unknown> = Promise.resolve(undefined);
let client: any;
let stop_view: (() => void) | undefined;
let stop_composer: (() => void) | undefined;
const globals = ["window", "document", "localStorage"];
const descriptors = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));

const assistant = (id: string): AssistantMessage => ({
  id, role: "assistant", model: "m", effort: "", mode: "auto", plan: false, created_at: "2026-10-07T00:00:00.000Z",
  ended_at: null, status: "streaming", steps: [], reasoning_details: [], retry: null, error: null, context: null, last_seq: 0,
});

const seed = (message_id = "m1") => {
  calls.length = 0;
  const chat: Chat = {
    id: "c1", title: "Fixture", project_path: "", workspace: "", pinned: false, created_at: "2026-10-07T00:00:00.000Z",
    updated_at: "2026-10-07T00:00:00.000Z", message_count: 1, streaming: true, summary: null, messages: [assistant(message_id)], questions: {},
  };
  client.chat_view_store.set(client.finish_load(client.begin_load(client.empty_chat_view, "c1"), "c1", chat));
  client.composer_store.set({
    ...client.empty_composer,
    queues: { c1: [
      { id: "q1", text: "same text", attachments: [], plan: false, steering: false },
      { id: "q2", text: "same text", attachments: [], plan: false, steering: false },
    ] },
  });
};

const queue = () => client.queue_of(client.composer_store.get(), "c1");

const emit = (event: TurnEvent) => {
  for (const listener of listeners.get("turn:event") ?? []) listener(event);
};

const taken = (steer_id: string, seq = 1, message_id = "m1"): TurnEvent => ({
  type: "steer", chat_id: "c1", message_id, steer_id, round: 1, text: "same text", seq, at: Date.now(),
});

const ended = (message_id = "m1"): TurnEvent => ({
  type: "end", chat_id: "c1", message_id, status: "stopped", error: null, seq: 2, at: Date.now(),
});

before(async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { lang: "en" }, visibilityState: "hidden", addEventListener: () => undefined, removeEventListener: () => undefined } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    innerWidth: 1440, matchMedia: () => ({ matches: false, addEventListener: () => {} }), setTimeout, clearTimeout,
    vx: {
      invoke: async (name: string, ...args: unknown[]) => {
        calls.push({ name, args });
        if (name === "turn:steer") return steer_result;
        if (name === "turn:send") return send_result;
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
    'export { composer_store, discard_queued, discard_upload, edit_queued, init_composer, queue_draft, send_plan_feedback, steer_queued, stop_turn, submit } from "./src/state/composer.ts";',
    'export { settings_store } from "./src/state/settings.ts";',
    'export { chat_view_store, init_chat_view } from "./src/state/chat-view.ts";',
    'export { empty_composer, queue_of } from "./src/state/chat-drafts.ts";',
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

test("real composer keeps an accepted steer until its event reaches the renderer", async () => {
  seed();
  steer_result = Promise.resolve("m1");
  await client.steer_queued("c1", "q1");
  assert.equal(queue().length, 2);
  assert.equal(queue()[0].steering, true);
  assert.equal(queue()[0].steer_turn_id, "m1");
  assert.equal(calls.filter((call) => call.name === "turn:steer").length, 1);
  const id = queue()[0].steer_id;
  assert.equal(calls.find((call) => call.name === "turn:steer")?.args[3], id);
  emit(taken(id));
  assert.deepEqual(queue().map((entry: { id: string }) => entry.id), ["q2"]);
});

test("a steer event that arrives before the IPC response does not restore a removed card", async () => {
  seed();
  let accept: ((value: string) => void) | undefined;
  steer_result = new Promise((resolve) => { accept = resolve; });
  const pending = client.steer_queued("c1", "q1");
  const id = queue()[0].steer_id;
  emit(taken(id));
  accept?.("m1");
  await pending;
  assert.deepEqual(queue().map((entry: { id: string }) => entry.id), ["q2"]);
});

test("an end before the IPC response keeps the card retryable and does not send a new turn", async () => {
  seed();
  let accept: ((value: string) => void) | undefined;
  steer_result = new Promise((resolve) => { accept = resolve; });
  const pending = client.steer_queued("c1", "q1");
  emit(ended());
  accept?.("m1");
  await pending;
  assert.equal(queue().length, 2);
  assert.equal(queue()[0].steering, false);
  assert.equal(queue()[0].steer_failed, true);
  assert.equal(calls.some((call) => call.name === "turn:send"), false);
});

test("a stopped turn releases its pending card as soon as stop is accepted", async () => {
  seed();
  steer_result = Promise.resolve("m1");
  await client.steer_queued("c1", "q1");
  await client.stop_turn("c1");
  assert.equal(queue()[0].steering, false);
  assert.equal(queue()[0].steer_failed, true);
  assert.equal(queue()[0].text, "same text");
});

test("a rejected steer leaves the message in its card without automatically sending it", async () => {
  seed();
  steer_result = Promise.resolve(null);
  await client.steer_queued("c1", "q1");
  assert.equal(queue().length, 2);
  assert.equal(queue()[0].steer_failed, true);
  assert.equal(calls.some((call) => call.name === "turn:send"), false);
});

test("a new attempt ignores old delivery events and another turn's end", async () => {
  seed();
  steer_result = Promise.resolve("m1");
  await client.steer_queued("c1", "q1");
  const old_id = queue()[0].steer_id;
  emit(ended());
  const retained = client.composer_store.get();
  seed("m2");
  client.composer_store.set(retained);
  steer_result = Promise.resolve("m2");
  await client.steer_queued("c1", "q1");
  const new_id = queue()[0].steer_id;
  assert.notEqual(new_id, old_id);
  emit(taken(old_id, 3, "m1"));
  emit(ended("m1"));
  assert.equal(queue()[0].steering, true);
  emit(taken(new_id, 1, "m2"));
  assert.deepEqual(queue().map((entry: { id: string }) => entry.id), ["q2"]);
});

test("a delayed done event from an older turn cannot send queued messages while a new turn runs", async () => {
  seed("m2");
  steer_result = Promise.resolve("m2");
  await client.steer_queued("c1", "q1");
  const event = ended("m1");
  assert.ok(event.type === "end");
  emit({ ...event, status: "done" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(queue().length, 2);
  assert.equal(queue()[0].steering, true);
  assert.equal(calls.some((call) => call.name === "turn:send"), false);
});

const image = (id: string, copy: string) => ({ id, kind: "image", name: `${id}.png`, mime: "image/png", size: 10, vision_note: null, model: { id: copy, width: 10, height: 10 } });

test("steers and discards hand main attachment ids, never records", async () => {
  seed();
  const steered = image("img_a_1.png", "img_a_2.jpg");
  const dropped = image("img_b_1.png", "img_b_2.jpg");
  const removed = image("img_c_1.png", "img_c_2.jpg");
  client.composer_store.set({
    ...client.composer_store.get(),
    queues: { c1: [
      { id: "q1", text: "look", attachments: [steered], plan: false, steering: false },
      { id: "q2", text: "", attachments: [dropped], plan: false, steering: false },
    ] },
    drafts: { c1: { text: "", plan: false, chips: [], uploads: [{ key: "u1", name: "c.png", size: 10, image: true, status: "ready", attachment: removed, preview: null }] } },
  });
  steer_result = Promise.resolve("m1");
  await client.steer_queued("c1", "q1");
  assert.deepEqual(calls.find((call) => call.name === "turn:steer")?.args.slice(1, 3), ["look", [steered.id]]);
  client.discard_queued("c1", "q2");
  client.discard_upload("c1", "u1");
  assert.deepEqual(calls.filter((call) => call.name === "attachments:discard").map((call) => call.args), [[[dropped.id]], [[removed.id]]]);
  assert.deepEqual(queue().map((entry: { id: string }) => entry.id), ["q1"]);
  assert.deepEqual(client.composer_store.get().drafts.c1.uploads, []);
});

const set_draft = (text: string, attachments: ReturnType<typeof image>[] = []) =>
  client.composer_store.set({
    ...client.composer_store.get(),
    drafts: { c1: { text, plan: false, chips: [], uploads: attachments.map((attachment) => ({ key: attachment.id, name: attachment.name, size: 10, image: true, status: "ready", attachment, preview: null })) } },
  });

const seed_idle = () => {
  seed();
  const done = { ...assistant("m1"), status: "done" as const, ended_at: "2026-10-07T00:00:01.000Z" };
  const chat: Chat = {
    id: "c1", title: "Fixture", project_path: "", workspace: "", pinned: false, created_at: "2026-10-07T00:00:00.000Z",
    updated_at: "2026-10-07T00:00:00.000Z", message_count: 1, streaming: false, summary: null, messages: [done], questions: {},
  };
  client.chat_view_store.set(client.finish_load(client.begin_load(client.empty_chat_view, "c1"), "c1", chat));
  client.composer_store.set(client.empty_composer);
};

test("Enter while the turn runs queues the draft as a row, and Steer on that row hands it to the turn", async () => {
  seed();
  steer_result = Promise.resolve("m1");
  const shot = image("img_d_1.png", "img_d_2.jpg");
  set_draft("look at this", [shot]);
  await client.submit("c1", "");
  const queued = queue().at(-1);
  assert.deepEqual([queued.text, queued.steering, queued.attachments], ["look at this", false, [shot]]);
  assert.equal(calls.some((call) => call.name === "turn:steer" || call.name === "turn:send"), false);
  await client.steer_queued("c1", queued.id);
  const steers = calls.filter((call) => call.name === "turn:steer");
  assert.equal(steers.length, 1);
  assert.deepEqual(steers[0].args.slice(0, 3), ["c1", "look at this", [shot.id]]);
  const entry = queue().at(-1);
  assert.equal(entry.steering, true);
  assert.equal(entry.steer_turn_id, "m1");
  assert.equal(entry.steer_id, steers[0].args[3]);
  assert.equal(client.composer_store.get().drafts.c1.text, "");
  assert.deepEqual(client.composer_store.get().drafts.c1.uploads, []);
  assert.equal(calls.some((call) => call.name === "turn:send"), false);
  emit(taken(entry.steer_id));
  assert.deepEqual(queue().map((item: { id: string }) => item.id), ["q1", "q2"]);
});

test("a refused or released steer of a queued draft becomes a Not sent row that keeps its attachments", async () => {
  seed();
  const refused = image("img_e_1.png", "img_e_2.jpg");
  steer_result = Promise.resolve(null);
  set_draft("too late", [refused]);
  await client.submit("c1", "");
  await client.steer_queued("c1", queue().at(-1).id);
  assert.equal(queue().at(-1).steer_failed, true);
  assert.deepEqual(queue().at(-1).attachments, [refused]);
  const released = image("img_f_1.png", "img_f_2.jpg");
  steer_result = Promise.resolve("m1");
  set_draft("", [released]);
  await client.submit("c1", "");
  await client.steer_queued("c1", queue().at(-1).id);
  assert.equal(queue().at(-1).steering, true);
  await client.stop_turn("c1");
  assert.equal(queue().at(-1).steer_failed, true);
  assert.deepEqual(queue().at(-1).attachments, [released]);
  assert.equal(calls.some((call) => call.name === "turn:send"), false);
});

test("Tab and plan feedback queue during a running turn instead of steering", async () => {
  seed();
  set_draft("after the turn");
  await client.queue_draft("c1");
  await client.send_plan_feedback("c1", "change step two");
  const added = queue().slice(2);
  assert.deepEqual(added.map((entry: { text: string; plan: boolean; steering: boolean }) => [entry.text, entry.plan, entry.steering]), [["after the turn", false, false], ["change step two", true, false]]);
  assert.equal(calls.some((call) => call.name === "turn:steer" || call.name === "turn:send"), false);
});

test("Enter on a plan draft while the turn runs queues it as a plan message instead of steering", async () => {
  seed();
  set_draft("plan the migration");
  client.composer_store.set({ ...client.composer_store.get(), drafts: { c1: { ...client.composer_store.get().drafts.c1, plan: true } } });
  await client.submit("c1", "");
  assert.deepEqual(queue().slice(2).map((entry: { text: string; plan: boolean; steering: boolean }) => [entry.text, entry.plan, entry.steering]), [["plan the migration", true, false]]);
  assert.equal(calls.some((call) => call.name === "turn:steer" || call.name === "turn:send"), false);
});

test("Enter while only a send is in flight queues, because no turn is running to steer", async () => {
  seed_idle();
  client.settings_store.set({ model: "m", effort: "high", mode: "auto" });
  let finish: (() => void) | undefined;
  send_result = new Promise<void>((resolve) => { finish = resolve; });
  set_draft("first");
  const first = client.submit("c1", "");
  assert.equal(client.composer_store.get().sending.c1, true);
  set_draft("second");
  await client.submit("c1", "");
  assert.deepEqual(queue().map((entry: { text: string; steering: boolean }) => [entry.text, entry.steering]), [["second", false]]);
  assert.equal(calls.filter((call) => call.name === "turn:send").length, 1);
  assert.equal(calls.some((call) => call.name === "turn:steer"), false);
  finish?.();
  await first;
  send_result = Promise.resolve(undefined);
});

test("Edit message moves a queued message into the draft without discarding its uploads or sending it", async () => {
  seed();
  const kept = image("img_g_1.png", "img_g_2.jpg");
  client.composer_store.set({
    ...client.composer_store.get(),
    queues: { c1: [
      { id: "q1", text: "fix the title", attachments: [kept], plan: false, steering: false },
      { id: "q2", text: "same text", attachments: [], plan: false, steering: false },
    ] },
  });
  set_draft("and the footer");
  client.edit_queued("c1", "q1");
  const draft = client.composer_store.get().drafts.c1;
  assert.equal(draft.text, "fix the title\nand the footer");
  assert.deepEqual(draft.uploads.map((upload: { attachment: unknown }) => upload.attachment), [kept]);
  assert.deepEqual(queue().map((entry: { id: string }) => entry.id), ["q2"]);
  assert.equal(calls.some((call) => ["attachments:discard", "turn:send", "turn:steer"].includes(call.name)), false);
});

test("a message that is waiting for the next round stays queued when edit is requested", async () => {
  seed();
  steer_result = Promise.resolve("m1");
  await client.steer_queued("c1", "q1");
  client.edit_queued("c1", "q1");
  assert.equal(queue()[0].steering, true);
  assert.equal(client.composer_store.get().drafts.c1, undefined);
});
