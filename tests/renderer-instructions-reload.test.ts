import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { Chat } from "../shared/chat.ts";
import { bundle, install_dom, stub_components, type FakeElement } from "./dom-kit.ts";

let client: any;
let container: FakeElement;
let root: any;
let stop = () => {};
let restore = () => {};
let stored = "original";
let accept: ((value: unknown) => void) | null = null;
let get_chat: () => Promise<Chat>;
const listeners = new Map<string, Set<(payload: any) => void>>();
const calls: { name: string; args: unknown[] }[] = [];
const view = () => ({ custom_instructions: stored, personality: "pragmatic", memory: { enabled: true, exclude_tool_chats: false }, model_context: {} });
const chat: Chat = { id: "c", title: "c", project_path: "D:/project", workspace: "", created_at: "2026-11-05T00:00:00Z", updated_at: "2026-11-05T00:00:00Z", pinned: false, message_count: 1, streaming: true, summary: null, questions: {}, messages: [{ id: "a", role: "assistant", model: "m", effort: "", mode: "auto", plan: false, status: "streaming", created_at: "2026-11-05T00:00:00Z", ended_at: null, steps: [], reasoning_details: [], retry: null, error: null, context: null, last_seq: 0 }] };
const emit = (name: string, payload: any) => { for (const listener of listeners.get(name) ?? []) listener(payload); };
const event = (seq: number, delta: string) => ({ type: "text", chat_id: "c", message_id: "a", seq, at: seq, round: 1, delta });
const settle = async () => { for (let index = 0; index < 5; ++index) await new Promise((resolve) => setTimeout(resolve, 0)); client.flushSync(() => {}); };
const props = (element: FakeElement): any => (element as any)[Object.keys(element).find((key) => key.startsWith("__reactProps$"))!];
const input = () => container.matching((node) => node.className.split(" ").includes("instructions-input"))[0];
const button = () => container.matching((node) => node.className.split(" ").includes("instructions-footer"))[0].matching((node) => node.nodeName === "BUTTON")[0];
const type = (value: string) => client.flushSync(() => props(input()).onChange({ target: { value } }));

before(async () => {
  const dom = install_dom({
    invoke: async (name, ...args) => {
      calls.push({ name, args });
      if (name === "settings:get") return view();
      if (name === "settings:update") return new Promise((resolve) => { accept = resolve; });
      if (name === "chats:get") return get_chat();
      if (name === "turn:context") return { used: 0, limit: 1000 };
      return undefined;
    },
    on: (name, callback) => { const group = listeners.get(name) ?? new Set(); listeners.set(name, group); group.add(callback); return () => { group.delete(callback); }; },
    send: () => {},
  });
  dom.document.visibilityState = "hidden";
  restore = dom.restore;
  client = await bundle([
    'export {createElement} from "react";',
    'export {flushSync} from "react-dom";',
    'export {createRoot} from "react-dom/client";',
    'export {PersonalizationPane} from "./src/features/settings/panes/PersonalizationPane.tsx";',
    'export {settings_store} from "./src/state/settings.ts";',
    'export {load_chat,chat_view_store,init_chat_view} from "./src/state/chat-view.ts";',
    'export {begin_load,finish_load,empty_chat_view} from "./src/state/chat-view-reduce.ts";',
  ], [stub_components("PersonalizationPane.tsx", { MemoryLists: 'export const MemoryLists=()=>null;' })]);
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
  stop = client.init_chat_view();
});
after(() => { stop(); root?.unmount(); restore(); });
beforeEach(() => {
  client.flushSync(() => root.render(null));
  stored = "original";
  accept = null;
  calls.length = 0;
  get_chat = async () => chat;
  client.settings_store.set(view());
  client.chat_view_store.set(client.finish_load(client.begin_load(client.empty_chat_view, "c"), "c", chat));
});

test("typing the prior saved instructions while saving survives successful completion", async () => {
  client.flushSync(() => root.render(client.createElement(client.PersonalizationPane)));
  type("submitted");
  client.flushSync(() => props(button()).onClick());
  await settle();
  type("original");
  stored = "submitted";
  accept!(view());
  await settle();
  assert.equal(props(input()).value, "original");
  assert.equal(props(button()).disabled, false);
});

test("failed real IPC reload replays held events once without an immediate retry loop", async () => {
  let reject = (_error: Error) => {};
  get_chat = () => new Promise((_resolve, decline) => { reject = decline; });
  const loading = client.load_chat("c");
  emit("turn:event", event(1, "held"));
  reject(Object.assign(new Error("offline"), { stack: "offline" }));
  await loading;
  await settle();
  assert.equal(calls.filter((call) => call.name === "chats:get").length, 1);
  assert.equal(client.chat_view_store.get().entries.c.stale, true);
  assert.equal(client.chat_view_store.get().entries.c.chat.messages[0].steps[0].text, "held");
  get_chat = async () => { throw Object.assign(new Error("still offline"), { stack: "still offline" }); };
  emit("turn:event", event(2, " later"));
  await settle();
  assert.equal(calls.filter((call) => call.name === "chats:get").length, 2);
  assert.equal(client.chat_view_store.get().entries.c.chat.messages[0].steps[0].text, "held later");
  get_chat = async () => chat;
  emit("turn:event", event(3, " trigger"));
  await settle();
  assert.equal(calls.filter((call) => call.name === "chats:get").length, 3);
  assert.equal(client.chat_view_store.get().entries.c.status, "ready");
  assert.equal(client.chat_view_store.get().entries.c.stale, false);
});
