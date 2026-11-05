import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Chat, UserMessage } from "../shared/chat.ts";
import type { StreamEventBody, TurnEvent } from "../shared/events.ts";
import type { Delivery } from "../src/api/smoother.ts";
import {
  apply_delivery,
  begin_load,
  empty_chat_view,
  finish_load,
  max_loaded_chats,
  receive,
  stale_chats,
  type ChatViewState,
} from "../src/state/chat-view-reduce.ts";

const user = (id: string, text = "hi"): UserMessage => ({ id, role: "user", text, attachments: [], origin: "user", created_at: "2026-10-06T10:00:00.000Z" });

const assistant = (id: string, last_seq = 0): AssistantMessage => ({
  id,
  role: "assistant",
  model: "m",
  effort: "high",
  mode: "ask",
  plan: false,
  created_at: "2026-10-06T10:00:01.000Z",
  ended_at: null,
  status: "streaming",
  steps: [],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq,
});

const chat = (id: string, messages: Chat["messages"]): Chat => ({
  id,
  title: "t",
  project_path: "D:\\p",
  workspace: "",
  pinned: false,
  created_at: "2026-10-06T10:00:00.000Z",
  updated_at: "2026-10-06T10:00:00.000Z",
  message_count: messages.length,
  streaming: true,
  summary: null,
  messages,
  questions: {},
});

type EventDelivery = Extract<Delivery, { kind: "event" }>;

const event = (seq: number, body: StreamEventBody, message_id = "a1", chat_id = "c1", partial = false): EventDelivery => ({
  kind: "event",
  event: { ...body, seq, at: 1000 + seq, chat_id, message_id } as TurnEvent,
  partial,
});

const text = (seq: number, delta: string, message_id = "a1", chat_id = "c1") => event(seq, { type: "text", round: 1, delta }, message_id, chat_id);

const loaded = (messages: Chat["messages"], chat_id = "c1"): ChatViewState => finish_load(begin_load(empty_chat_view, chat_id), chat_id, chat(chat_id, messages));

const message_of = (state: ChatViewState, message_id: string, chat_id = "c1") => {
  const found = state.entries[chat_id]?.chat?.messages.find((message) => message.id === message_id);
  assert.ok(found, `message ${message_id} missing`);
  return found;
};

const answer = (state: ChatViewState, message_id = "a1", chat_id = "c1") => {
  const message = message_of(state, message_id, chat_id);
  assert.equal(message.role, "assistant");
  return message.role === "assistant" ? message.steps.map((step) => (step.kind === "text" ? step.text : `[${step.kind}]`)).join("") : "";
};

test("events for a loaded message apply in order and duplicates by seq are ignored", () => {
  let state = loaded([user("u1"), assistant("a1")]);
  state = receive(state, [text(1, "Hel"), text(2, "lo")]);
  state = receive(state, [text(2, "lo"), text(1, "Hel")]);
  assert.equal(answer(state), "Hello");
  const message = message_of(state, "a1");
  assert.equal(message.role === "assistant" && message.last_seq, 2);
});

test("a snapshot that already contains an event makes the live copy of it a no-op", () => {
  const snapshot = assistant("a1", 5);
  snapshot.steps = [{ id: "text:4", round: 1, kind: "text", text: "done" }];
  let state = loaded([user("u1"), snapshot]);
  state = receive(state, [text(5, " again"), text(6, "!")]);
  assert.equal(answer(state), "done!");
});

test("partial deliveries apply their text but keep last_seq until the final piece", () => {
  const piece = (delta: string, partial: boolean) => event(4, { type: "text", round: 1, delta }, "a1", "c1", partial);
  const first = apply_delivery(assistant("a1", 3), piece("ab", true));
  assert.equal(first.last_seq, 3);
  const second = apply_delivery(first, piece("cd", true));
  const last = apply_delivery(second, piece("e", false));
  assert.equal(last.last_seq, 4);
  assert.deepEqual(
    last.steps.map((step) => step.kind === "text" && step.text),
    ["abcde"],
  );
  assert.equal(last.steps[0].id, "text:4");
});

const draft_body = (delta: string, lines: number): StreamEventBody => ({ type: "tool_draft", round: 1, index: 0, name: "write_file", lines, delta });

const draft_of = (message: ReturnType<typeof message_of>) => {
  const step = message.role === "assistant" ? message.steps[0] : undefined;
  return step?.kind === "tool" ? { text: step.progress?.draft_text, lines: step.progress?.lines } : null;
};

test("partial tool_draft deliveries grow the draft text and its line count piece by piece", () => {
  const piece = (delta: string, partial: boolean) => event(4, draft_body(delta, 3), "a1", "c1", partial);
  const first = apply_delivery(assistant("a1", 3), piece("one\nt", true));
  assert.deepEqual(draft_of(first), { text: "one\nt", lines: 2 });
  assert.equal(first.last_seq, 3);
  const last = apply_delivery(first, piece("wo\nthree", false));
  assert.deepEqual(draft_of(last), { text: "one\ntwo\nthree", lines: 3 });
  assert.equal(last.last_seq, 4);
});

test("a chat loaded in the middle of a draft continues it without doubling text", () => {
  const snapshot = apply_delivery(apply_delivery(assistant("a1"), event(1, draft_body("a\n", 2))), event(2, draft_body("b", 2)));
  let state = loaded([user("u1"), snapshot]);
  state = receive(state, [event(2, draft_body("b", 2)), event(3, draft_body("\nc", 3))]);
  assert.deepEqual(draft_of(message_of(state, "a1")), { text: "a\nb\nc", lines: 3 });
});

test("events that arrive while the chat loads are held and replayed after the snapshot", () => {
  let state = begin_load(empty_chat_view, "c1");
  state = receive(state, [text(1, "A"), text(2, "B"), text(3, "C")]);
  const snapshot = assistant("a1", 2);
  snapshot.steps = [{ id: "text:1", round: 1, kind: "text", text: "AB" }];
  state = finish_load(state, "c1", chat("c1", [user("u1"), snapshot]));
  assert.equal(state.entries.c1?.status, "ready");
  assert.equal(answer(state), "ABC");
  assert.deepEqual(state.entries.c1?.held, []);
});

test("events for a message that is not loaded yet wait until chats:appended delivers it", () => {
  let state = loaded([user("u1")]);
  state = receive(state, [text(1, "Hi"), text(2, " there")]);
  assert.equal(state.entries.c1?.chat?.messages.length, 1);
  assert.equal(state.entries.c1?.waiting.a1?.length, 2);
  state = receive(state, [{ kind: "appended", chat_id: "c1", message: assistant("a1") }]);
  assert.equal(answer(state), "Hi there");
  assert.equal(state.entries.c1?.waiting.a1, undefined);
});

test("chats:appended inserts only when the message is missing", () => {
  let state = loaded([user("u1"), assistant("a1")]);
  state = receive(state, [text(1, "x")]);
  state = receive(state, [{ kind: "appended", chat_id: "c1", message: assistant("a1") }]);
  assert.equal(state.entries.c1?.chat?.messages.length, 2);
  assert.equal(answer(state), "x");
  state = receive(state, [{ kind: "appended", chat_id: "c1", message: user("u2") }]);
  assert.deepEqual(
    state.entries.c1?.chat?.messages.map((message) => message.id),
    ["u1", "a1", "u2"],
  );
});

test("chats:truncated removes every message after the named one", () => {
  let state = loaded([user("u1"), assistant("a1"), user("u2"), assistant("a2")]);
  state = receive(state, [{ kind: "truncated", chat_id: "c1", message_id: "u1" }]);
  assert.deepEqual(
    state.entries.c1?.chat?.messages.map((message) => message.id),
    ["u1"],
  );
  const unchanged = receive(state, [{ kind: "truncated", chat_id: "c1", message_id: "missing" }]);
  assert.equal(unchanged, state);
});

test("chats:message_replaced swaps an edited message in place", () => {
  let state = loaded([user("u1", "old text"), assistant("a1")]);
  state = receive(state, [
    { kind: "truncated", chat_id: "c1", message_id: "u1" },
    { kind: "replaced", chat_id: "c1", message: user("u1", "new text") },
  ]);
  const first = state.entries.c1?.chat?.messages[0];
  assert.equal(first?.role === "user" && first.text, "new text");
  assert.equal(state.entries.c1?.chat?.messages.length, 1);
  const unchanged = receive(state, [{ kind: "replaced", chat_id: "c1", message: user("missing", "x") }]);
  assert.equal(unchanged, state);
});

test("deliveries for chats that are not loaded are dropped", () => {
  const state = loaded([user("u1"), assistant("a1")]);
  const next = receive(state, [text(1, "x", "a9", "other")]);
  assert.equal(next, state);
});

test("a chat that is reopened while loading keeps showing its old snapshot", () => {
  let state = loaded([user("u1"), assistant("a1")]);
  state = begin_load(state, "c1");
  assert.equal(state.entries.c1?.status, "loading");
  assert.equal(state.entries.c1?.chat?.messages.length, 2);
});

test("an overflowing wait buffer marks the chat stale for a reload", () => {
  let state = loaded([user("u1")]);
  const flood = [...Array(4001).keys()].map((index) => text(index + 1, "x"));
  state = receive(state, flood);
  assert.deepEqual(stale_chats(state), ["c1"]);
});

test("opening more chats than the limit evicts the least recently opened", () => {
  let state = empty_chat_view;
  for (let index = 0; index <= max_loaded_chats; index += 1) {
    state = begin_load(state, `c${index}`);
  }
  assert.equal(Object.keys(state.entries).length, max_loaded_chats);
  assert.equal(state.entries.c0, undefined);
  assert.ok(state.entries[`c${max_loaded_chats}`]);
});

test("the end event settles running tools and closes the turn", () => {
  let state = loaded([user("u1"), assistant("a1")]);
  state = receive(state, [
    event(1, { type: "tool_call", round: 1, index: 0, call_id: "k1", name: "run_command", args: { command: "ls" } }),
    event(2, { type: "tool_start", call_id: "k1" }),
    event(3, { type: "end", status: "stopped", error: null }),
  ]);
  const message = message_of(state, "a1");
  assert.equal(message.role === "assistant" && message.status, "stopped");
  assert.equal(message.role === "assistant" && message.steps[0].kind === "tool" && message.steps[0].status, "cancelled");
});
