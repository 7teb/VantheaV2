import assert from "node:assert/strict";
import { test } from "node:test";
import { parse_body } from "../electron/chats/files.ts";
import { apply_event, apply_events } from "../shared/apply-event.ts";
import type { AssistantMessage } from "../shared/chat.ts";
import type { Sequenced, StreamEventBody, TranscriptState } from "../shared/events.ts";

const message = (): AssistantMessage => ({
  id: "m1",
  role: "assistant",
  model: "vendor/model",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-11-20T10:00:00.000Z",
  ended_at: null,
  status: "streaming",
  steps: [],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

const at = (seq: number, body: StreamEventBody): Sequenced & StreamEventBody => ({ seq, at: seq * 10, ...body });

const usage_event = (round: number, prompt_tokens: number, completion_tokens: number, reasoning_tokens: number): StreamEventBody => ({
  type: "usage",
  round,
  prompt_tokens,
  completion_tokens,
  reasoning_tokens,
});

test("a message without usage events has no usage field", () => {
  const state = apply_events(message(), [at(1, { type: "text", round: 0, delta: "Hi" }), at(2, { type: "end", status: "done", error: null })]);
  assert.equal(state.usage, undefined);
});

test("usage events add up from zero and count one round each", () => {
  const state = apply_events(message(), [
    at(1, { type: "text", round: 0, delta: "Reading." }),
    at(2, usage_event(0, 1200, 80, 30)),
    at(3, { type: "text", round: 1, delta: "Done." }),
    at(4, usage_event(1, 1500, 40, 0)),
    at(5, { type: "end", status: "done", error: null }),
  ]);
  assert.deepEqual(state.usage, { prompt_tokens: 2700, completion_tokens: 120, reasoning_tokens: 30, rounds: 2 });
  assert.equal(state.last_seq, 5);
  assert.equal(state.steps.length, 2);
});

test("a usage event applied twice with the same seq counts once", () => {
  const event = at(1, usage_event(0, 100, 10, 5));
  const once = apply_event(message(), event);
  const twice = apply_event(once, event);
  assert.equal(twice, once);
  assert.deepEqual(twice.usage, { prompt_tokens: 100, completion_tokens: 10, reasoning_tokens: 5, rounds: 1 });
  const replayed = apply_events(message(), [event, at(2, usage_event(1, 50, 5, 0)), event, at(2, usage_event(1, 50, 5, 0))]);
  assert.deepEqual(replayed.usage, { prompt_tokens: 150, completion_tokens: 15, reasoning_tokens: 5, rounds: 2 });
});

test("usage continues from a usage already stored on the message", () => {
  const stored = { ...message(), usage: { prompt_tokens: 10, completion_tokens: 1, reasoning_tokens: 0, rounds: 1 }, last_seq: 3 };
  const state = apply_event(stored, at(4, usage_event(1, 20, 2, 1)));
  assert.deepEqual(state.usage, { prompt_tokens: 30, completion_tokens: 3, reasoning_tokens: 1, rounds: 2 });
});

test("an agent transcript applies usage the same way", () => {
  const transcript: TranscriptState = { status: "streaming", steps: [], reasoning_details: [], retry: null, error: null, context: null, last_seq: 0, ended_at: null };
  const state = apply_events(transcript, [at(1, usage_event(0, 7, 3, 0))]);
  assert.deepEqual(state.usage, { prompt_tokens: 7, completion_tokens: 3, reasoning_tokens: 0, rounds: 1 });
});

test("a stored usage survives the chat file coercion on load", () => {
  const usage = { prompt_tokens: 900, completion_tokens: 60, reasoning_tokens: 12, rounds: 3 };
  const stored = JSON.parse(JSON.stringify({ messages: [{ ...message(), status: "done", usage }], summary: null, questions: {} })) as unknown;
  const body = parse_body(stored, "chat_usage");
  const loaded = body?.messages[0];
  assert.equal(loaded?.role, "assistant");
  assert.deepEqual(loaded?.role === "assistant" ? loaded.usage : null, usage);
});

test("a malformed stored usage is dropped on load instead of reaching the run totals", () => {
  for (const usage of ["12", { prompt_tokens: 1, completion_tokens: 2, reasoning_tokens: 0 }, { prompt_tokens: -1, completion_tokens: 2, reasoning_tokens: 0, rounds: 1 }, { prompt_tokens: "1", completion_tokens: 2, reasoning_tokens: 0, rounds: 1 }]) {
    const stored = JSON.parse(JSON.stringify({ messages: [{ ...message(), status: "done", usage }], summary: null, questions: {} })) as unknown;
    const loaded = parse_body(stored, "chat_usage")?.messages[0];
    assert.equal(loaded?.role, "assistant");
    assert.equal(loaded && "usage" in loaded, false, JSON.stringify(usage));
  }
});
