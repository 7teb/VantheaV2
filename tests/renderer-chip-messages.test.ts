import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Chat } from "../shared/chat.ts";
import type { Delivery } from "../src/api/smoother.ts";
import { draft_of, empty_composer, enqueue, message_text, patch_draft, queued_to_draft, restore_draft, take_draft, visualize_chip } from "../src/state/chat-drafts.ts";
import { begin_load, empty_chat_view, fail_load, finish_load, max_buffered, receive } from "../src/state/chat-view-reduce.ts";

const chips = [{ kind: "skill", name: "example" }, { kind: "mcp", name: "server" }, visualize_chip] as const;
const assistant = (id: string): AssistantMessage => ({ id, role: "assistant", model: "m", effort: "", mode: "auto", plan: false, status: "streaming", created_at: "2026-11-05T00:00:00Z", ended_at: null, steps: [], reasoning_details: [], retry: null, error: null, context: null, last_seq: 0 });
const chat: Chat = { id: "c", title: "c", project_path: "D:/project", workspace: "", created_at: "2026-11-05T00:00:00Z", updated_at: "2026-11-05T00:00:00Z", pinned: false, message_count: 1, streaming: true, summary: null, messages: [assistant("a")], questions: {} };
const text = (seq: number, delta: string, id = "a"): Delivery => ({ kind: "event", partial: false, event: { type: "text", chat_id: "c", message_id: id, seq, at: seq, round: 1, delta } });
const ready = () => finish_load(begin_load(empty_chat_view, "c"), "c", chat);
const answer = (state: ReturnType<typeof ready>, id = "a") => {
  const message = state.entries.c.chat?.messages.find((entry) => entry.id === id);
  return message?.role === "assistant" ? message.steps.flatMap((step) => step.kind === "text" ? [step.text] : []).join("") : null;
};

test("failed chip sends restore editable text and chip objects without hidden instruction lines", () => {
  const initial = patch_draft(empty_composer, "c", { text: "  original text  ", chips: [...chips] });
  const taken = take_draft(initial, "c");
  const restored = draft_of(restore_draft(taken.state, "c", taken.message), "c");
  assert.equal(restored.text, "  original text  ");
  assert.deepEqual(restored.chips, chips);
  assert.equal(message_text(restored), taken.message.text);
});

test("queued chip messages preserve metadata and merge subsequent typing and chips once", () => {
  const taken = take_draft(patch_draft(empty_composer, "c", { text: "old", chips: [...chips], plan: true }), "c");
  let state = enqueue(taken.state, "c", { ...taken.message, id: "q", steering: false });
  state = patch_draft(state, "c", { text: "new", chips: [chips[0], { kind: "mcp", name: "later" }] });
  const restored = draft_of(queued_to_draft(state, "c", "q"), "c");
  assert.equal(restored.text, "old\nnew");
  assert.deepEqual(restored.chips, [...chips, { kind: "mcp", name: "later" }]);
  assert.equal(restored.plan, true);
});

test("a typed instruction-looking line without chip metadata remains literal text", () => {
  const original = message_text({ ...draft_of(empty_composer, "c"), text: "literal", chips: [...chips] });
  const restored = draft_of(restore_draft(empty_composer, "c", { text: original, attachments: [], plan: false }), "c");
  assert.equal(restored.text, original);
  assert.deepEqual(restored.chips, []);
});

test("a chip-only send restores chips without inventing text or a leading newline", () => {
  const taken = take_draft(patch_draft(empty_composer, "c", { chips: [...chips] }), "c");
  const current = patch_draft(taken.state, "c", { text: "typed later" });
  const restored = draft_of(restore_draft(current, "c", taken.message), "c");
  assert.equal(restored.text, "typed later");
  assert.deepEqual(restored.chips, chips);
});

test("a failed reload replays held events over the retained chat in order", () => {
  let state = begin_load(ready(), "c");
  state = receive(state, [text(1, "hello"), text(2, " world"), text(2, " world")]);
  state = fail_load(state, "c");
  assert.equal(answer(state), "hello world");
  assert.equal(state.entries.c.held.length, 0);
  assert.equal(state.entries.c.status, "ready");
});

test("a failed reload keeps buffered events for a not-yet-appended assistant", () => {
  let state = receive(ready(), [text(1, "waiting", "later")]);
  state = fail_load(begin_load(state, "c"), "c");
  state = receive(state, [{ kind: "appended", chat_id: "c", message: assistant("later") }]);
  assert.equal(answer(state, "later"), "waiting");
});

test("a successful reload reconciles prior waiting events and drops duplicate snapshot events", () => {
  let state = receive(ready(), [text(1, "waiting", "later")]);
  state = finish_load(begin_load(state, "c"), "c", { ...chat, messages: [...chat.messages, assistant("later")] });
  assert.equal(answer(state, "later"), "waiting");
});

test("restarting a pending load does not drop its held deliveries", () => {
  let state = receive(begin_load(ready(), "c"), [text(1, "held")]);
  state = finish_load(begin_load(state, "c"), "c", chat);
  assert.equal(answer(state), "held");
});

test("failed initial load has no fictitious ready chat and held overflow stays stale", () => {
  assert.equal(fail_load(begin_load(empty_chat_view, "c"), "c").entries.c.status, "failed");
  const batch = Array.from({ length: max_buffered + 1 }, (_, index) => text(index + 1, "x"));
  const state = fail_load(receive(begin_load(ready(), "c"), batch), "c");
  assert.equal(state.entries.c.stale, true);
});

test("a failed recovery reload retains a prior overflow stale marker for a later retry", () => {
  const batch = Array.from({ length: max_buffered + 1 }, (_, index) => text(index + 1, "x", "later"));
  const overflowed = receive(ready(), batch);
  assert.equal(overflowed.entries.c.stale, true);
  const failed = fail_load(begin_load(overflowed, "c"), "c");
  assert.equal(failed.entries.c.stale, true);
});
