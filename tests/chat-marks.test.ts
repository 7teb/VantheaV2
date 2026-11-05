import assert from "node:assert/strict";
import { test } from "node:test";
import type { StreamEventBody, TurnEvent } from "../shared/events.ts";
import { activity_entries, day_groups, needs_attention } from "../src/features/sidebar/activity.ts";
import { mark_all_read, mark_event, mark_seen, row_status, type ChatMarks } from "../src/state/chat-marks-rules.ts";

const event = (body: StreamEventBody, chat_id = "c1"): TurnEvent => ({ chat_id, message_id: "m1", seq: 1, at: 0, ...body });

const approval = (call_id: string, chat_id = "c1") =>
  event({ type: "tool_approval", call_id, request: {} as Extract<StreamEventBody, { type: "tool_approval" }>["request"] }, chat_id);

const ended = (status: "done" | "stopped" | "interrupted", kind?: string, chat_id = "c1") =>
  event({ type: "end", status, error: kind ? ({ kind, message: "x" } as Extract<StreamEventBody, { type: "end" }>["error"]) : null }, chat_id);

const run = (events: TurnEvent[], viewing = false, start: ChatMarks = {}) => events.reduce((marks, next) => mark_event(marks, next, viewing), start);

test("a pending approval marks the chat as waiting until the call starts, ends or the turn ends", () => {
  const waiting = run([approval("a")]);
  assert.equal(row_status(waiting.c1, true), "waiting");
  assert.equal(row_status(run([event({ type: "tool_start", call_id: "a" })], false, waiting).c1, true), "running");
  assert.equal(
    row_status(run([event({ type: "tool_end", call_id: "a", status: "denied", view: null, error: null, result_text: "" })], false, waiting).c1, true),
    "running",
  );
  assert.equal(run([ended("stopped")], true, waiting).c1, undefined);
  assert.deepEqual(run([approval("a"), approval("b"), event({ type: "tool_start", call_id: "a" })]).c1?.pending, ["b"]);
});

test("a finished turn in a chat the user is not viewing is unread until the chat is opened", () => {
  const marks = run([ended("done")]);
  assert.equal(row_status(marks.c1, false), "unread");
  assert.equal(mark_seen(marks, "c1").c1, undefined);
  assert.equal(run([ended("done")], true).c1, undefined);
  assert.equal(run([ended("stopped")]).c1, undefined);
  assert.equal(run([ended("interrupted", "app_closed")]).c1, undefined);
});

test("questions shown in a chat the user is not viewing mark it as waiting until it is opened", () => {
  const asked = run([event({ type: "tool_end", call_id: "q", status: "done", view: { kind: "questions", questions: [] }, error: null, result_text: "" })]);
  assert.equal(row_status(asked.c1, true), "waiting");
  assert.equal(row_status(run([ended("done")], false, asked).c1, false), "waiting");
  assert.equal(mark_seen(run([ended("done")], false, asked), "c1").c1, undefined);
});

test("events that change nothing keep the same marks object, and other chats are left alone", () => {
  const marks = run([approval("a", "c2")]);
  assert.equal(mark_event(marks, event({ type: "text", round: 0, delta: "hi" } as StreamEventBody), false), marks);
  assert.equal(mark_event(marks, event({ type: "tool_start", call_id: "x" }), false), marks);
  assert.equal(mark_seen(marks, "c1"), marks);
  assert.deepEqual(Object.keys(run([ended("done")], false, marks)), ["c2", "c1"]);
  assert.equal(row_status(undefined, false), "idle");
});

test("the activity list puts waiting chats first, then new responses, then running ones, and only waiting or unread ones ring the bell", () => {
  const chat = (id: string, updated_at: string, streaming = false, archived = false) =>
    ({ id, title: id, project_path: "", workspace: "", pinned: false, archived, created_at: updated_at, updated_at, message_count: 1, streaming }) as const;
  const chats = [chat("idle", "2026-10-26T10:00:00Z"), chat("run", "2026-10-26T10:05:00Z", true), chat("new", "2026-10-26T09:00:00Z"), chat("wait", "2026-10-26T08:00:00Z"), chat("gone", "2026-10-26T11:00:00Z", false, true)];
  const marks = run([approval("a", "wait"), ended("done", undefined, "new"), ended("done", undefined, "gone")]);
  const entries = activity_entries(chats, marks);
  assert.deepEqual(entries.map((entry) => `${entry.chat.id}:${entry.status}`), ["wait:waiting", "new:unread", "run:running"]);
  assert.equal(needs_attention(entries), true);
  assert.equal(needs_attention(entries.filter((entry) => entry.status === "running")), false);
});

test("mark all as read clears new responses and questions but keeps approvals that still wait", () => {
  const marks = run([approval("a", "c1"), ended("done", undefined, "c2")]);
  const cleared = mark_all_read(marks);
  assert.equal(cleared.c2, undefined);
  assert.deepEqual(cleared.c1?.pending, ["a"]);
  const none: ChatMarks = {};
  assert.equal(mark_all_read(none), none);
});

test("the activity view groups the other chats by today, yesterday, each weekday of this week and older", () => {
  const chat = (id: string, updated_at: string, archived = false) =>
    ({ id, title: id, project_path: "", workspace: "", pinned: false, archived, created_at: updated_at, updated_at, message_count: 1, streaming: false }) as const;
  const now = Date.parse("2026-10-26T12:00:00");
  const chats = [
    chat("a", "2026-10-26T09:00:00"),
    chat("b", "2026-10-25T20:00:00"),
    chat("c", "2026-10-23T10:00:00"),
    chat("d", "2026-10-23T08:00:00"),
    chat("e", "2026-10-22T08:00:00"),
    chat("f", "2026-10-10T08:00:00"),
    chat("g", "2026-10-01T08:00:00"),
    chat("x", "2026-10-26T11:00:00", true),
    chat("p", "2026-10-26T11:30:00"),
  ];
  const groups = day_groups(chats, new Set(["p"]), now);
  assert.deepEqual(groups.map((group) => `${group.kind}:${group.chats.map((entry) => entry.id).join("")}`), ["today:a", "yesterday:b", "weekday:cd", "weekday:e", "older:fg"]);
});
