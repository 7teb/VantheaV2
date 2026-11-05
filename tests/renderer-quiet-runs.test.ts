import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Message, UserMessage } from "../shared/chat.ts";
import { chat_rows, type ChatRow } from "../src/features/chat/quiet-runs.ts";
import { turn_segments } from "../src/state/turn-groups.ts";

const prompt = (id: string, origin: UserMessage["origin"] = "scheduled"): UserMessage => ({
  id,
  role: "user",
  text: "Check the heat.",
  attachments: [],
  origin,
  created_at: "2026-11-04T08:00:00.000Z",
});

const answer = (id: string, status: AssistantMessage["status"], quiet: boolean): AssistantMessage => ({
  id,
  role: "assistant",
  model: "openai/gpt-sol",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-11-04T08:00:01.000Z",
  ended_at: status === "streaming" ? null : "2026-11-04T08:00:30.000Z",
  status,
  steps: [{ id: `${id}_t`, round: 1, kind: "text", text: quiet ? "NO_NEW_ACTIVITY" : "New heat record in Mali." }],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 1,
  ...(quiet ? { quiet: true as const } : {}),
});

const shape = (rows: ChatRow[]) =>
  rows.map((row) => {
    if (row.kind === "quiet") {
      return `quiet:${row.runs.map((run) => run.answer.id).join(",")}`;
    }
    return row.segment.kind === "user" ? `user:${row.segment.message.id}` : `turn:${row.segment.members.map((member) => member.id).join(",")}`;
  });

const rows_of = (messages: Message[], keep: string | null = null) => shape(chat_rows(turn_segments(messages), keep));

test("a quiet scheduled run collapses into one quiet line, a run with news stays a divider and a turn", () => {
  const messages: Message[] = [prompt("p1"), answer("a1", "done", false), prompt("p2"), answer("a2", "done", true)];
  assert.deepEqual(rows_of(messages), ["user:p1", "turn:a1", "quiet:a2"]);
});

test("quiet runs in a row group into one line until a run with news, a failure or a running run ends the group", () => {
  const messages: Message[] = [
    prompt("p1"),
    answer("a1", "done", true),
    prompt("p2"),
    answer("a2", "done", true),
    prompt("p3"),
    answer("a3", "done", true),
    prompt("p4"),
    answer("a4", "failed", true),
    prompt("p5"),
    answer("a5", "done", true),
    prompt("p6"),
    answer("a6", "streaming", false),
  ];
  assert.deepEqual(rows_of(messages), ["quiet:a1,a2,a3", "user:p4", "turn:a4", "quiet:a5", "user:p6", "turn:a6"]);
});

test("only scheduled prompts fold: a quiet answer after a user message keeps its turn", () => {
  const messages: Message[] = [prompt("u1", "user"), answer("a1", "done", true)];
  assert.deepEqual(rows_of(messages), ["user:u1", "turn:a1"]);
});

test("a run that carries the compaction line stays a full turn so the line keeps its place", () => {
  const messages: Message[] = [prompt("p1"), answer("a1", "done", true), prompt("p2"), answer("a2", "done", true)];
  assert.deepEqual(rows_of(messages, "p2"), ["quiet:a1", "user:p2", "turn:a2"]);
  assert.deepEqual(rows_of(messages, "a1"), ["user:p1", "turn:a1", "quiet:a2"]);
});

test("a run whose turn picked up an agent report stays a full turn", () => {
  const messages: Message[] = [prompt("p1"), answer("a1", "done", true), prompt("r1", "agent_report"), answer("a2", "done", true)];
  assert.deepEqual(rows_of(messages), ["user:p1", "turn:a1,a2"]);
});

test("only the turn right after a scheduled prompt counts as a scheduled run", () => {
  const messages: Message[] = [prompt("u1", "user"), answer("a1", "done", false), prompt("p2"), answer("a2", "streaming", false)];
  assert.deepEqual(
    chat_rows(turn_segments(messages), null).map((row) => row.kind === "segment" && row.scheduled_run),
    [false, false, false, true],
  );
});
