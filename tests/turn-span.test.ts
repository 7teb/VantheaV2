import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Message, UserMessage } from "../shared/chat.ts";
import { joins_turn, newest_span, span_of } from "../shared/turn-span.ts";

const user = (id: string, origin: UserMessage["origin"] = "user"): UserMessage => ({ id, role: "user", text: "", attachments: [], origin, created_at: "2026-10-26T10:00:00.000Z" });

const turn = (id: string, steps: AssistantMessage["steps"] = []): AssistantMessage => ({
  id,
  role: "assistant",
  model: "m",
  effort: "",
  mode: "auto",
  plan: false,
  created_at: "2026-10-26T10:00:00.000Z",
  ended_at: "2026-10-26T10:01:00.000Z",
  status: "done",
  steps,
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

const compaction = (id: string): AssistantMessage => turn(id, [{ id: "c", round: 0, kind: "compaction", source: "manual", status: "done" }]);

test("agent reports and agent updates join the turn before them, every other origin starts a new group", () => {
  assert.equal(joins_turn("agent_report"), true);
  assert.equal(joins_turn("agent_update"), true);
  for (const origin of ["user", "background", "continue", "undo", "plan_accept", "init", "git_init", "review"] as const) assert.equal(joins_turn(origin), false);
  const messages: Message[] = [user("u1"), turn("a1"), user("r1", "agent_update"), turn("a2"), user("r2", "agent_report"), turn("a3"), user("u2"), turn("a4")];
  assert.deepEqual(span_of(messages, "a1"), { from_id: "a1", to_id: "a3" });
  assert.deepEqual(span_of(messages, "a2"), { from_id: "a1", to_id: "a3" });
  assert.deepEqual(span_of(messages, "a3"), { from_id: "a1", to_id: "a3" });
  assert.deepEqual(span_of(messages, "a4"), { from_id: "a4", to_id: "a4" });
  assert.equal(span_of(messages, "u1"), null);
  assert.equal(span_of(messages, "missing"), null);
});

test("a background result and an assistant message without a report in between start their own groups", () => {
  const messages: Message[] = [turn("a1"), user("b1", "background"), turn("a2"), turn("a3")];
  assert.deepEqual(span_of(messages, "a1"), { from_id: "a1", to_id: "a1" });
  assert.deepEqual(span_of(messages, "a2"), { from_id: "a2", to_id: "a2" });
  assert.deepEqual(span_of(messages, "a3"), { from_id: "a3", to_id: "a3" });
});

test("newest_span skips a group led by a manual compaction", () => {
  const messages: Message[] = [user("u1"), turn("a1"), user("r1", "agent_report"), turn("a2"), compaction("k1")];
  assert.deepEqual(newest_span(messages), { from_id: "a1", to_id: "a2" });
  assert.deepEqual(newest_span([...messages, user("u2"), turn("a3")]), { from_id: "a3", to_id: "a3" });
  assert.equal(newest_span([compaction("k0")]), null);
  assert.equal(newest_span([]), null);
});
