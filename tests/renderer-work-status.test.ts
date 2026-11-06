import assert from "node:assert/strict";
import { test } from "node:test";
import { apply_event } from "../shared/apply-event.ts";
import type { AssistantMessage, ToolStep } from "../shared/chat.ts";
import type { StreamEventBody } from "../shared/events.ts";
import { build_blocks, is_live_block, shows_thinking, type Block } from "../src/features/chat/assistant-blocks.ts";
import { is_reviewing } from "../src/features/tools/review-phase.ts";
import { tool_label } from "../src/features/tools/tool-meta.ts";
import { group_current, group_label } from "../src/features/tools/tool-summary.ts";
import { work_tools } from "../src/features/tools/work-steps.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const en: Translate = (key, vars) => translate("en", key, vars);

const de: Translate = (key, vars) => translate("de", key, vars);

const fresh = (): AssistantMessage => ({
  id: "m1",
  role: "assistant",
  model: "inclusionai/ling-3.1-flash",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-12T10:00:00.000Z",
  ended_at: null,
  status: "streaming",
  steps: [],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

const play = (bodies: StreamEventBody[], from: AssistantMessage = fresh()): AssistantMessage =>
  bodies.reduce((state, body) => apply_event(state, { ...body, seq: state.last_seq + 1, at: 1000 + state.last_seq * 10 }), from);

const grep_then_read: StreamEventBody[] = [
  { type: "tool_call", round: 0, index: 0, call_id: "c0_0", name: "grep_files", args: { query: "compaction_due" } },
  { type: "tool_call", round: 0, index: 1, call_id: "c0_1", name: "read_file", args: { path: "electron/turn/loop.ts" } },
  { type: "tool_start", call_id: "c0_0" },
];

const grep_done: StreamEventBody = {
  type: "tool_end",
  call_id: "c0_0",
  status: "done",
  view: { kind: "grep", query: "compaction_due", matches: [], total: 3, truncated: false },
  error: null,
  result_text: "3 matching lines",
};

const read_done: StreamEventBody = {
  type: "tool_end",
  call_id: "c0_1",
  status: "done",
  view: { kind: "read", path: "electron/turn/loop.ts", start_line: 1, end_line: 98, total_lines: 98, truncated: false },
  error: null,
  result_text: "...",
};

const tools_of = (message: AssistantMessage): ToolStep[] => message.steps.filter((step): step is ToolStep => step.kind === "tool");

const tail = (message: AssistantMessage): Block | undefined => build_blocks(message.steps).at(-1);

const thinking = (message: AssistantMessage) => shows_thinking(message.status === "streaming", message.retry !== null, build_blocks(message.steps));

test("the group heading names the running search, not the read queued behind it", () => {
  const message = play(grep_then_read);
  const current = group_current(tools_of(message));
  assert.equal(current?.name, "grep_files");
  assert.equal(tool_label(en, current as ToolStep), "Searching compaction_due");
  assert.equal(tool_label(de, current as ToolStep), "Sucht compaction_due");
});

test("the heading follows the queue: the read once the search is done, the summary once both are done", () => {
  const searching_done = play([...grep_then_read, grep_done]);
  assert.equal(group_current(tools_of(searching_done))?.name, "read_file");
  const reading = play([{ type: "tool_start", call_id: "c0_1" }], searching_done);
  assert.equal(tool_label(en, group_current(tools_of(reading)) as ToolStep), "Reading loop.ts");
  const finished = play([read_done], reading);
  assert.equal(group_current(tools_of(finished)), null);
  assert.equal(group_label(en, tools_of(finished)), "Read files");
});

test("a command awaiting approval or under review wins over a queued read", () => {
  const command: StreamEventBody[] = [
    { type: "tool_call", round: 0, index: 0, call_id: "c0_0", name: "run_command", args: { command: "npm test" } },
    { type: "tool_call", round: 0, index: 1, call_id: "c0_1", name: "read_file", args: { path: "README.md" } },
    { type: "tool_start", call_id: "c0_0" },
  ];
  const reviewed = play([...command, { type: "tool_progress", call_id: "c0_0", progress: { label: "", lines: null, output_tail: null, phase: "review" } }]);
  const current = group_current(tools_of(reviewed));
  assert.equal(current?.name, "run_command");
  assert.equal(is_reviewing(current as ToolStep), true);
  const waiting = play([...command, { type: "tool_approval", call_id: "c0_0", request: { kind: "command", command: "npm test" } as never }]);
  assert.equal(group_current(tools_of(waiting))?.status, "awaiting_approval");
  assert.equal(group_current(tools_of(waiting))?.name, "run_command");
});

test("while the model drafts, the last drafted call names the group, also after finished calls of an earlier round", () => {
  const drafting = play([
    { type: "tool_draft", round: 0, index: 0, name: "grep_files", lines: null },
    { type: "tool_draft", round: 0, index: 1, name: "read_file", lines: null },
  ]);
  assert.equal(group_current(tools_of(drafting))?.name, "read_file");
  const later = play([...grep_then_read, grep_done, { type: "tool_start", call_id: "c0_1" }, read_done, { type: "tool_draft", round: 1, index: 0, name: "write_file", lines: null }]);
  assert.equal(build_blocks(later.steps).length, 1);
  assert.equal(group_current(tools_of(later))?.name, "write_file");
});

test("live blocks: active tools, running or waiting compaction, open reasoning and text", () => {
  assert.equal(is_live_block(tail(play(grep_then_read))), true);
  assert.equal(is_live_block(tail(play([...grep_then_read, grep_done, { type: "tool_start", call_id: "c0_1" }, read_done]))), false);
  const compacting = play([{ type: "compaction", round: 1, status: "running", source: "auto", attempt: 1, attempts: 14 }]);
  assert.equal(is_live_block(tail(compacting)), true);
  const waiting = play([{ type: "compaction", round: 1, status: "waiting", source: "auto", attempt: 7, attempts: 14, error: { kind: "rate_limited", message: "429" }, wait_ms: 60_000 }], compacting);
  assert.equal(is_live_block(tail(waiting)), true);
  for (const status of ["done", "failed"] as const) {
    assert.equal(is_live_block(tail(play([{ type: "compaction", round: 1, status, source: "auto" }]))), false);
  }
  const interrupted = play([{ type: "end", status: "stopped", error: null }], waiting);
  const settled = tail(interrupted);
  assert.equal(settled?.kind === "compaction" && settled.step.status, "interrupted");
  assert.equal(is_live_block(tail(interrupted)), false);
  const reasoning = play([{ type: "reasoning", round: 0, delta: "hm" }]);
  assert.equal(is_live_block(tail(reasoning)), true);
  assert.equal(is_live_block(tail(play([{ type: "text", round: 0, delta: "ok" }], reasoning))), true);
  const drafting = build_blocks(play([{ type: "tool_draft", round: 0, index: 0, name: "read_file", lines: null }], reasoning).steps);
  assert.deepEqual(drafting.map((block) => block.kind), ["work"]);
  assert.equal(is_live_block(drafting[0]), true);
  assert.equal(is_live_block(build_blocks(play([{ type: "text", round: 0, delta: "ok" }], reasoning).steps)[0]), false);
  assert.equal(is_live_block(tail(play([{ type: "steer", round: 0, text: "also" }]))), false);
  assert.equal(is_live_block(tail(play([{ type: "notice", round: 0, notice: "context_trimmed", text: "t" }]))), false);
  assert.equal(is_live_block(undefined), false);
});

test("a finished tail group is not running while the next call is pending, a Thinking row shows instead", () => {
  const done = play([...grep_then_read, grep_done, { type: "tool_start", call_id: "c0_1" }, read_done]);
  assert.equal(group_current(tools_of(done)), null);
  assert.equal(thinking(done), true);
  assert.equal(thinking(play([{ type: "reasoning", round: 1, delta: "next" }], done)), false);
  assert.equal(thinking(play([{ type: "text", round: 1, delta: "Answer" }], done)), false);
  assert.equal(thinking(play(grep_then_read)), false);
  assert.equal(thinking(play([{ type: "end", status: "done", error: null }], done)), false);
  assert.equal(thinking(fresh()), true);
});

test("during a compaction retry the finished group above shows its summary, the compaction line is the live row and no Thinking row is added", () => {
  const done = play([...grep_then_read, grep_done, { type: "tool_start", call_id: "c0_1" }, read_done]);
  const waiting = play(
    [
      { type: "compaction", round: 1, status: "running", source: "auto", attempt: 7, attempts: 14 },
      { type: "compaction", round: 1, status: "waiting", source: "auto", attempt: 7, attempts: 14, error: { kind: "rate_limited", message: "429" }, wait_ms: 60_000 },
    ],
    done,
  );
  const blocks = build_blocks(waiting.steps);
  assert.deepEqual(blocks.map((block) => block.kind), ["work", "compaction"]);
  const group = blocks[0];
  assert.ok(group?.kind === "work");
  assert.equal(group_current(work_tools(group.steps)), null);
  assert.equal(thinking(waiting), false);
  const compacted = play([{ type: "compaction", round: 1, status: "done", source: "auto" }], waiting);
  assert.equal(thinking(compacted), true);
});

test("during a model retry the finished group shows its summary and the retry banner replaces the Thinking row", () => {
  const done = play([...grep_then_read, grep_done, { type: "tool_start", call_id: "c0_1" }, read_done]);
  const retrying = play([{ type: "reasoning", round: 1, delta: "x" }, { type: "retry", round: 1, attempt: 2, max: 6, reason: "rate_limited", wait_ms: 5000 }], done);
  assert.ok(retrying.retry);
  assert.equal(group_current(tools_of(retrying)), null);
  assert.equal(thinking(retrying), false);
});
