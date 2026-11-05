import assert from "node:assert/strict";
import { test } from "node:test";
import { apply_events } from "../shared/apply-event.ts";
import type { AssistantMessage } from "../shared/chat.ts";
import type { Sequenced, StreamEventBody } from "../shared/events.ts";
import { review_record } from "./fixtures/review/record.ts";

const message = (): AssistantMessage => ({
  id: "m1",
  role: "assistant",
  model: "x",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-06T00:00:00.000Z",
  ended_at: null,
  status: "streaming",
  steps: [],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

let seq = 0;
const ev = (body: StreamEventBody): Sequenced & StreamEventBody => ({ seq: ++seq, at: seq * 10, ...body });

test("text deltas in one round merge into one step and close reasoning", () => {
  seq = 0;
  const state = apply_events(message(), [
    ev({ type: "reasoning", round: 0, delta: "think" }),
    ev({ type: "text", round: 0, delta: "Hel" }),
    ev({ type: "text", round: 0, delta: "lo" }),
  ]);
  assert.equal(state.steps.length, 2);
  assert.equal(state.steps[0]?.kind, "reasoning");
  assert.notEqual(state.steps[0]?.kind === "reasoning" ? state.steps[0].ended_at : null, null);
  assert.deepEqual(state.steps[1], { id: "text:2", round: 0, kind: "text", text: "Hello" });
});

test("reasoning details are kept per round and a repeated round replaces its entry", () => {
  seq = 0;
  const first = [{ type: "reasoning.text", text: "a", index: 0 }];
  const second = [{ type: "reasoning.encrypted", data: "QUJD", index: 0 }];
  const again = [{ type: "reasoning.text", text: "a2", index: 0 }];
  const state = apply_events(message(), [
    ev({ type: "reasoning_details", round: 0, details: first }),
    ev({ type: "reasoning_details", round: 1, details: second }),
    ev({ type: "reasoning_details", round: 0, details: again }),
  ]);
  assert.deepEqual(state.reasoning_details, [
    { round: 1, details: second },
    { round: 0, details: again },
  ]);
  assert.equal(state.steps.length, 0);
});

test("retry drops the failed attempt of the round but keeps finished tools", () => {
  seq = 0;
  const state = apply_events(message(), [
    ev({ type: "tool_call", round: 0, index: 0, call_id: "c0", name: "read_file", args: {} }),
    ev({ type: "tool_end", call_id: "c0", status: "done", view: null, error: null, result_text: "ok" }),
    ev({ type: "text", round: 1, delta: "partial" }),
    ev({ type: "tool_draft", round: 1, index: 0, name: "write_file", lines: 3 }),
    ev({ type: "retry", round: 1, attempt: 2, max: 3, reason: "stream_interrupted", wait_ms: 2000 }),
  ]);
  assert.equal(state.steps.length, 1);
  assert.equal(state.retry?.attempt, 2);
});

test("tool lifecycle and end settles open tools", () => {
  seq = 0;
  const state = apply_events(message(), [
    ev({ type: "tool_call", round: 0, index: 0, call_id: "c0", name: "run_command", args: { command: "x" } }),
    ev({ type: "tool_call", round: 0, index: 1, call_id: "c1", name: "run_command", args: { command: "y" } }),
    ev({ type: "tool_start", call_id: "c0" }),
    ev({ type: "end", status: "stopped", error: null }),
  ]);
  assert.equal(state.status, "stopped");
  const statuses = state.steps.map((step) => (step.kind === "tool" ? step.status : step.kind));
  assert.deepEqual(statuses, ["cancelled", "cancelled"]);
});

test("tool_start after an approval clears the card and keeps the first start time", () => {
  seq = 0;
  const state = apply_events(message(), [
    ev({ type: "tool_call", round: 0, index: 0, call_id: "c0", name: "write_file", args: {} }),
    ev({ type: "tool_start", call_id: "c0" }),
    ev({ type: "tool_approval", call_id: "c0", request: { kind: "memory", action: "remember", text: "x" } }),
    ev({ type: "tool_start", call_id: "c0" }),
  ]);
  const step = state.steps[0];
  assert.equal(step?.kind === "tool" && step.status, "running");
  assert.equal(step?.kind === "tool" && step.approval, null);
  assert.equal(step?.kind === "tool" && step.started_at, 20);
});

test("end settles a running compaction as interrupted", () => {
  seq = 0;
  const state = apply_events(message(), [
    ev({ type: "compaction", round: 0, status: "running", source: "auto" }),
    ev({ type: "end", status: "interrupted", error: { kind: "app_closed", message: "closed" } }),
  ]);
  const step = state.steps[0];
  assert.equal(step?.kind === "compaction" && step.status, "interrupted");
});

test("a compaction keeps one step per round with its source and start time, and clears a retry", () => {
  seq = 0;
  const state = apply_events(message(), [
    ev({ type: "compaction", round: 2, status: "running", source: "manual" }),
    ev({ type: "retry", round: 2, attempt: 2, max: 3, reason: "rate_limited", wait_ms: 1000 }),
    ev({ type: "compaction", round: 2, status: "done", source: "manual" }),
  ]);
  assert.equal(state.retry, null);
  assert.deepEqual(state.steps, [{ id: "compaction:2", round: 2, kind: "compaction", status: "done", source: "manual", started_at: 10 }]);
});

type DraftBody = Extract<StreamEventBody, { type: "tool_draft" }>;

const draft = (round: number, extra: Partial<DraftBody> = {}) => ev({ type: "tool_draft", round, index: 0, name: "replace_in_file", lines: 0, ...extra });

const progress_of = (state: ReturnType<typeof message>) => {
  const step = state.steps.find((entry) => entry.kind === "tool");
  return step?.kind === "tool" ? { status: step.status, progress: step.progress, args: step.args } : null;
};

test("tool_draft deltas append to the draft text, keep path and old text, and count lines from the text", () => {
  seq = 0;
  const state = apply_events(message(), [
    draft(0),
    draft(0, { lines: 2, delta: "a\nb", path: "src/x.ts", old_text: "old" }),
    draft(0, { lines: 3, delta: "c\nd" }),
    draft(0, { lines: 3 }),
  ]);
  assert.deepEqual(progress_of(state), {
    status: "drafting",
    args: {},
    progress: { label: "", lines: 3, output_tail: null, draft_text: "a\nbc\nd", draft_path: "src/x.ts", draft_old: "old" },
  });
  const without_text = apply_events(message(), [draft(0, { name: "write_file", lines: 4 })]);
  assert.deepEqual(progress_of(without_text)?.progress, { label: "", lines: 4, output_tail: null });
});

test("tool_call takes over a drafted step with the full args and clears the draft", () => {
  seq = 0;
  const state = apply_events(message(), [
    draft(0, { name: "write_file", lines: 1, delta: "print(1)", path: "a.py" }),
    ev({ type: "tool_call", round: 0, index: 0, call_id: "c0_0", name: "write_file", args: { path: "a.py", content: "print(1)" } }),
  ]);
  assert.deepEqual(progress_of(state), { status: "queued", args: { path: "a.py", content: "print(1)" }, progress: null });
  assert.equal(state.steps.length, 1);
});

test("retry and end drop drafting steps together with their draft text", () => {
  seq = 0;
  const retried = apply_events(message(), [
    draft(0, { name: "write_file", lines: 2, delta: "x\ny" }),
    ev({ type: "retry", round: 0, attempt: 2, max: 3, reason: "stream_interrupted", wait_ms: 1000 }),
  ]);
  assert.equal(retried.steps.length, 0);
  const restarted = apply_events(retried, [draft(0, { name: "write_file", lines: 1, delta: "fresh" })]);
  assert.equal(progress_of(restarted)?.progress?.draft_text, "fresh");
  const ended = apply_events(restarted, [ev({ type: "end", status: "stopped", error: null })]);
  assert.equal(ended.steps.length, 0);
  assert.equal(ended.status, "stopped");
});

test("events at or below last_seq are ignored", () => {
  seq = 0;
  const first = ev({ type: "text", round: 0, delta: "a" });
  const state = apply_events(message(), [first, first]);
  assert.equal(state.steps[0]?.kind === "text" ? state.steps[0].text : "", "a");
});

test("tool_review appends records to its step and replaces a record with the same id", () => {
  seq = 0;
  const first = review_record("r1", { verdict: "review", reason: "first" });
  const again = review_record("r1", { verdict: "review", reason: "again" });
  const second = review_record("r2", { verdict: "deny", source: "floor" });
  const state = apply_events(message(), [
    ev({ type: "tool_call", round: 0, index: 0, call_id: "c0", name: "run_command", args: { command: "x" } }),
    ev({ type: "tool_call", round: 0, index: 1, call_id: "c1", name: "run_command", args: { command: "y" } }),
    ev({ type: "tool_review", call_id: "c0", review: first }),
    ev({ type: "tool_review", call_id: "c0", review: second }),
    ev({ type: "tool_review", call_id: "c0", review: again }),
  ]);
  const [reviewed, untouched] = state.steps;
  assert.deepEqual(reviewed?.kind === "tool" ? reviewed.reviews : null, [second, again]);
  assert.equal(untouched?.kind === "tool" && "reviews" in untouched, false);
});

test("a tool step without review events has no reviews field", () => {
  seq = 0;
  const state = apply_events(message(), [
    ev({ type: "tool_call", round: 0, index: 0, call_id: "c0", name: "run_command", args: { command: "x" } }),
    ev({ type: "tool_start", call_id: "c0" }),
    ev({ type: "tool_end", call_id: "c0", status: "done", view: null, error: null, result_text: "ok" }),
  ]);
  assert.equal(Object.hasOwn(state.steps[0] ?? {}, "reviews"), false);
});

test("a steer keeps its push time and a steer event without one leaves the step without it", () => {
  seq = 0;
  const state = apply_events(message(), [
    ev({ type: "steer", round: 0, text: "stamped", pushed_at: 5, steer_id: "s1" }),
    ev({ type: "steer", round: 1, text: "legacy", steer_id: "s2" }),
  ]);
  assert.deepEqual(state.steps, [
    { id: "steer:1", round: 0, kind: "steer", text: "stamped", at: 5, steer_id: "s1" },
    { id: "steer:2", round: 1, kind: "steer", text: "legacy", steer_id: "s2" },
  ]);
});

const review_phase = { label: "", lines: null, output_tail: null, phase: "review" as const };

const reviewing_command = () => [
  ev({ type: "tool_call", round: 0, index: 0, call_id: "c0", name: "run_command", args: { command: "npm test" } }),
  ev({ type: "tool_start", call_id: "c0" }),
  ev({ type: "tool_progress", call_id: "c0", progress: review_phase }),
];

test("the review phase rides on tool progress and the next progress replaces it", () => {
  seq = 0;
  const reviewing = apply_events(message(), reviewing_command());
  assert.deepEqual(progress_of(reviewing), { status: "running", args: { command: "npm test" }, progress: review_phase });
  const cleared = apply_events(reviewing, [ev({ type: "tool_progress", call_id: "c0", progress: { label: "", lines: null, output_tail: null } })]);
  assert.equal(progress_of(cleared)?.progress?.phase, undefined);
  const output = apply_events(reviewing, [ev({ type: "tool_progress", call_id: "c0", progress: { label: "", lines: 1, output_tail: "ok" } })]);
  assert.deepEqual(progress_of(output)?.progress, { label: "", lines: 1, output_tail: "ok" });
});

test("tool_approval clears the review phase even when its clear was throttled away", () => {
  seq = 0;
  const state = apply_events(message(), [
    ...reviewing_command(),
    ev({ type: "tool_approval", call_id: "c0", request: { kind: "command", command: "npm test", cwd: "C:/p", background: false, review: null, grant_prefix: null } }),
  ]);
  assert.equal(progress_of(state)?.status, "awaiting_approval");
  assert.equal(progress_of(state)?.progress, null);
});

test("tool_end and a stopped turn leave no running review phase behind", () => {
  seq = 0;
  const ended = apply_events(message(), [...reviewing_command(), ev({ type: "tool_end", call_id: "c0", status: "denied", view: null, error: null, result_text: "Denied" })]);
  assert.deepEqual([progress_of(ended)?.status, progress_of(ended)?.progress], ["denied", null]);
  seq = 0;
  const stopped = apply_events(message(), [...reviewing_command(), ev({ type: "end", status: "stopped", error: null })]);
  assert.equal(progress_of(stopped)?.status, "cancelled");
});

test("tool_end images land on the step and a tool_end without images adds none", () => {
  seq = 0;
  const images = [{ id: "img_a_b.jpg", label: "[Screenshot s1]" }];
  const state = apply_events(message(), [
    ev({ type: "tool_call", round: 0, index: 0, call_id: "c0", name: "browser_screenshot", args: {} }),
    ev({ type: "tool_call", round: 0, index: 1, call_id: "c1", name: "browser_snapshot", args: {} }),
    ev({ type: "tool_start", call_id: "c0" }),
    ev({ type: "tool_end", call_id: "c0", status: "done", view: null, error: null, result_text: "shot", images }),
    ev({ type: "tool_start", call_id: "c1" }),
    ev({ type: "tool_end", call_id: "c1", status: "done", view: null, error: null, result_text: "tree" }),
  ]);
  const tools = state.steps.filter((step) => step.kind === "tool");
  assert.deepEqual(tools[0]?.kind === "tool" && tools[0].images, images);
  assert.equal(tools[1]?.kind === "tool" && "images" in tools[1], false);
});
