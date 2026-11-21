import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApprovalInfo, ChatActivity } from "../shared/api/contract.ts";
import { build_run_result, run_text, sum_usage } from "../shared/api/result.ts";
import type { AssistantMessage, MessageUsage, Step, TextStep, ToolStep } from "../shared/chat.ts";
import type { ToolView } from "../shared/tool-view.ts";

const text = (round: number, value: string): TextStep => ({ id: `text:${round}:${value}`, round, kind: "text", text: value });

const tool = (round: number, name: string, view: ToolView | null = null, status: ToolStep["status"] = "done"): ToolStep => ({
  id: `tool:${round}:${name}`,
  round,
  kind: "tool",
  index: 0,
  call_id: `c${round}_0`,
  name,
  args: {},
  status,
  progress: null,
  approval: null,
  view,
  error: null,
  result_text: "",
  started_at: 1,
  ended_at: 2,
});

const edit = (round: number, path: string, added: number, removed: number, created = false): ToolStep =>
  tool(round, "edit_file", { kind: "edit", path, created, added, removed, diff: [] });

const assistant = (id: string, steps: Step[], patch: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id,
  role: "assistant",
  model: "vendor/model",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-11-20T10:00:00.000Z",
  ended_at: "2026-11-20T10:01:00.000Z",
  status: "done",
  steps,
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 10,
  ...patch,
});

const idle: ChatActivity = { turn: false, agents: 0, workflows: 0, background: 0, queued: 0 };

const usage = (prompt_tokens: number, completion_tokens: number, reasoning_tokens: number, rounds: number): MessageUsage => ({
  prompt_tokens,
  completion_tokens,
  reasoning_tokens,
  rounds,
});

const result_of = (messages: AssistantMessage[], settled: boolean, extra: { approvals?: ApprovalInfo[]; active?: ChatActivity } = {}) =>
  build_run_result({
    run_id: messages[0]?.id ?? "none",
    session_id: "chat_1",
    settled,
    messages,
    questions: [],
    approvals: extra.approvals ?? [],
    active: extra.active ?? idle,
    started_at: "2026-11-20T10:00:00.000Z",
  });

test("run_text without tool steps is the whole text", () => {
  assert.equal(run_text([text(0, "Hello "), { id: "r", round: 0, kind: "reasoning", text: "x", started_at: 1, ended_at: 2 }, text(0, "world.")]), "Hello world.");
});

test("run_text keeps only the text after the last tool step", () => {
  assert.equal(run_text([text(0, "Let me look."), tool(0, "read_file"), text(1, "Still looking."), tool(1, "grep_files"), text(2, "The test fails because of X.")]), "The test fails because of X.");
  assert.equal(run_text([text(0, "Reading."), tool(0, "read_file")]), "");
  assert.equal(run_text([]), "");
});

test("run_text joins an output-limit continuation seamlessly across rounds", () => {
  const steps: Step[] = [
    tool(0, "read_file"),
    text(1, "The first half of a long sen"),
    { id: "notice:1", round: 1, kind: "notice", notice: "output_limit", text: "" },
    text(2, "tence and its end."),
  ];
  assert.equal(run_text(steps), "The first half of a long sentence and its end.");
});

test("run_text separates answers of different rounds that were not cut", () => {
  const steps: Step[] = [text(0, "First answer."), { id: "steer:1", round: 1, kind: "steer", text: "And more?" }, text(1, "Second answer.")];
  assert.equal(run_text(steps), "First answer.\n\nSecond answer.");
});

test("sum_usage adds every message and treats a missing usage as zero", () => {
  const messages = [assistant("m1", [], { usage: usage(100, 20, 5, 2) }), assistant("m2", []), assistant("m3", [], { usage: usage(50, 10, 0, 1) })];
  assert.deepEqual(sum_usage(messages), usage(150, 30, 5, 3));
  assert.deepEqual(sum_usage([]), usage(0, 0, 0, 0));
});

test("a run that is not settled reports running and no end time", () => {
  const streaming = assistant("m1", [text(0, "Work")], { status: "streaming", ended_at: null });
  const result = result_of([streaming], false, { active: { ...idle, turn: true } });
  assert.equal(result.status, "running");
  assert.equal(result.ended_at, null);
  assert.equal(result.error, null);
  assert.equal(result.text, "Work");
  assert.deepEqual(result.active, { ...idle, turn: true });
  const ended_but_open = result_of([assistant("m1", [text(0, "Done.")])], false, { active: { ...idle, agents: 1 } });
  assert.equal(ended_but_open.status, "running");
  assert.equal(ended_but_open.ended_at, null);
});

test("a settled run takes status, error, end time and text from its last message", () => {
  const first = assistant("m1", [edit(0, "src/a.ts", 3, 1), text(1, "Started an agent.")], { usage: usage(10, 2, 0, 2) });
  const last = assistant("m2", [edit(0, "src/a.ts", 2, 0), edit(0, "src/b.ts", 5, 0, true), text(1, "All fixed.")], {
    ended_at: "2026-11-20T10:05:00.000Z",
    usage: usage(30, 4, 1, 2),
  });
  const result = result_of([first, last], true);
  assert.equal(result.run_id, "m1");
  assert.equal(result.session_id, "chat_1");
  assert.equal(result.status, "done");
  assert.equal(result.error, null);
  assert.equal(result.text, "All fixed.");
  assert.equal(result.ended_at, "2026-11-20T10:05:00.000Z");
  assert.equal(result.started_at, "2026-11-20T10:00:00.000Z");
  assert.deepEqual(result.messages, [first, last]);
  assert.deepEqual(result.changed_files, [
    { path: "src/a.ts", added: 5, removed: 1, created: false },
    { path: "src/b.ts", added: 5, removed: 0, created: true },
  ]);
  assert.deepEqual(result.usage, usage(40, 6, 1, 4));
  assert.deepEqual(result.needs_input, { questions: [], approvals: [], plan_message_id: null });
});

test("a failed run carries the error of its last message", () => {
  const error = { kind: "rate_limited" as const, message: "Too many requests" };
  const result = result_of([assistant("m1", [text(0, "Partial")], { status: "failed", error })], true);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.error, error);
  assert.equal(result.ended_at, "2026-11-20T10:01:00.000Z");
});

test("a run whose last message presented a plan names it in needs_input", () => {
  const plan = assistant("m1", [text(0, "Here is the plan."), tool(0, "present_plan", { kind: "plan", text: "1. Do it" })], { plan: true });
  assert.equal(result_of([plan], true).needs_input.plan_message_id, "m1");
  const stopped = assistant("m1", plan.steps, { plan: true, status: "stopped" });
  assert.equal(result_of([stopped], true).needs_input.plan_message_id, null);
  const failed_tool = assistant("m1", [tool(0, "present_plan", null, "failed")], { plan: true });
  assert.equal(result_of([failed_tool], true).needs_input.plan_message_id, null);
  const earlier_plan = [plan, assistant("m2", [text(0, "Implemented.")])];
  assert.equal(result_of(earlier_plan, true).needs_input.plan_message_id, null);
});

test("pending approvals and open questions pass through to needs_input", () => {
  const approval: ApprovalInfo = {
    approval_id: "m:c0_0",
    source: "main",
    agent_id: null,
    run_id: null,
    call_id: "c0_0",
    request: { kind: "command", command: "npm test", cwd: "D:/proj", background: false, review: null, grant_prefix: "npm test" },
  };
  const question = { id: "m1:c0_1:0", message_id: "m1", call_id: "c0_1", index: 0, title: "Which file?", options: ["a", "b"] };
  const result = build_run_result({
    run_id: "m1",
    session_id: "chat_1",
    settled: true,
    messages: [assistant("m1", [text(0, "Need input.")])],
    questions: [question],
    approvals: [approval],
    active: idle,
    started_at: "2026-11-20T10:00:00.000Z",
  });
  assert.deepEqual(result.needs_input.questions, [question]);
  assert.deepEqual(result.needs_input.approvals, [approval]);
});

test("a settled run with no message yet stays running", () => {
  const result = result_of([], true);
  assert.equal(result.status, "running");
  assert.equal(result.text, "");
  assert.deepEqual(result.usage, usage(0, 0, 0, 0));
});
