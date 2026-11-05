import assert from "node:assert/strict";
import { test } from "node:test";
import { apply_events } from "../shared/apply-event.ts";
import type { AssistantMessage, Message, ReasoningStep, UserMessage } from "../shared/chat.ts";
import type { Sequenced, StreamEventBody } from "../shared/events.ts";
import { clean_status, recent_user_texts, status_messages, status_system } from "../electron/side/status-prompt.ts";
import { parse_event } from "../electron/agents/records.ts";
import { interrupt_message } from "../electron/chats/settle.ts";
import { build_blocks, shows_thinking } from "../src/features/chat/assistant-blocks.ts";

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

const reasoning_steps = (state: AssistantMessage) => state.steps.filter((step): step is ReasoningStep => step.kind === "reasoning");

test("a status lands on the open reasoning step of its round and leaves the text alone", () => {
  seq = 0;
  const state = apply_events(message(), [
    ev({ type: "reasoning", round: 0, delta: "Reading store.ts" }),
    ev({ type: "reasoning_status", round: 0, text: "Reading the chat store." }),
    ev({ type: "reasoning", round: 0, delta: " and its queue." }),
    ev({ type: "reasoning_status", round: 0, text: "Checking the save queue." }),
  ]);
  assert.deepEqual(reasoning_steps(state), [
    { id: "reasoning:1", round: 0, kind: "reasoning", text: "Reading store.ts and its queue.", started_at: 10, ended_at: null, status_line: "Checking the save queue." },
  ]);
});

test("a status without a reasoning step of its round that has text is ignored, so a hidden route keeps the plain Thinking row", () => {
  seq = 0;
  const hidden = apply_events(message(), [
    ev({ type: "notice", round: 1, notice: "context_trimmed", text: "trimmed" }),
    ev({ type: "reasoning_status", round: 1, text: "Comparing both agent reports." }),
  ]);
  assert.deepEqual(reasoning_steps(hidden), []);
  const blocks = build_blocks(hidden.steps);
  assert.deepEqual(blocks.map((block) => block.kind), ["notice"]);
  assert.equal(shows_thinking(true, false, blocks), true);
  const visible = apply_events(hidden, [ev({ type: "reasoning", round: 1, delta: "Visible now." })]);
  assert.deepEqual(reasoning_steps(visible), [{ id: "reasoning:3", round: 1, kind: "reasoning", text: "Visible now.", started_at: 30, ended_at: null }]);
  assert.equal(shows_thinking(true, false, build_blocks(visible.steps)), false);
  const stale = apply_events(visible, [ev({ type: "reasoning_status", round: 0, text: "Reading an older round." })]);
  assert.equal(reasoning_steps(stale)[0]?.status_line, undefined);
  const after_text = apply_events(visible, [ev({ type: "text", round: 1, delta: "Answer" }), ev({ type: "reasoning_status", round: 1, text: "Reading the visible text." })]);
  assert.deepEqual(
    after_text.steps.map((step) => [step.kind, "status_line" in step]),
    [
      ["notice", false],
      ["reasoning", true],
      ["text", false],
    ],
  );
  assert.equal(reasoning_steps(after_text)[0]?.status_line, "Reading the visible text.");
});

const closings = [
  { type: "text", round: 0, delta: "Answer" },
  { type: "tool_draft", round: 0, index: 0, name: "read_file", lines: null },
  { type: "end", status: "stopped", error: null },
] satisfies StreamEventBody[];

test("closing the block keeps the status on the finished step as its description", () => {
  for (const closing of closings) {
    seq = 0;
    const state = apply_events(message(), [
      ev({ type: "reasoning", round: 0, delta: "Reading config.json" }),
      ev({ type: "reasoning_status", round: 0, text: "Reading config.json." }),
      ev(closing),
    ]);
    const [step] = reasoning_steps(state);
    assert.ok(step);
    assert.equal(step.ended_at, 30);
    assert.equal(step.status_line, "Reading config.json.");
    assert.equal(step.started_at, 10);
    assert.equal(step.text, "Reading config.json");
  }
});

const status_only: ReasoningStep = { id: "reasoning:1", round: 0, kind: "reasoning", text: "", started_at: 3, ended_at: null, status_line: "Reading config.json." };

test("a reasoning step that closes without reasoning text is dropped, its status line does not count", () => {
  for (const closing of closings) {
    seq = 1;
    const state = apply_events({ ...message(), steps: [status_only], last_seq: 1 }, [ev(closing)]);
    assert.deepEqual(reasoning_steps(state), [], closing.type);
  }
  const reloaded = interrupt_message({ ...message(), steps: [status_only], last_seq: 1 }, 50);
  assert.equal(reloaded.status, "interrupted");
  assert.deepEqual(reasoning_steps(reloaded), []);
  seq = 0;
  const blank = apply_events(message(), [ev({ type: "reasoning", round: 0, delta: "\n\n" }), ev({ type: "text", round: 0, delta: "Answer" })]);
  assert.deepEqual(reasoning_steps(blank), []);
  seq = 0;
  const kept = apply_events(message(), [
    ev({ type: "reasoning", round: 0, delta: "First thought" }),
    ev({ type: "tool_draft", round: 0, index: 0, name: "read_file", lines: null }),
    ev({ type: "reasoning_status", round: 1, text: "Reading the result." }),
    ev({ type: "text", round: 1, delta: "Done" }),
  ]);
  assert.deepEqual(
    reasoning_steps(kept).map((step) => [step.round, step.text, step.ended_at]),
    [[0, "First thought", 20]],
  );
});

test("a late status lands on the closed reasoning step of its round without reopening or moving it", () => {
  seq = 0;
  const state = apply_events(message(), [
    ev({ type: "reasoning", round: 0, delta: "Comparing both save paths." }),
    ev({ type: "tool_draft", round: 0, index: 0, name: "read_file", lines: null }),
    ev({ type: "tool_call", round: 0, index: 0, call_id: "c0_0", name: "read_file", args: {} }),
    ev({ type: "tool_start", call_id: "c0_0" }),
    ev({ type: "reasoning", round: 1, delta: "Reading the result." }),
    ev({ type: "reasoning_status", round: 0, text: "Compares both save paths." }),
  ]);
  assert.deepEqual(
    state.steps.map((step) => [step.kind, step.round, step.kind === "reasoning" ? [step.ended_at, step.status_line] : null]),
    [
      ["reasoning", 0, [20, "Compares both save paths."]],
      ["tool", 0, null],
      ["reasoning", 1, [null, undefined]],
    ],
  );
});

test("a status skips a blank reasoning step and lands on the newest reasoning of its round that has text", () => {
  seq = 0;
  const state = apply_events(message(), [
    ev({ type: "reasoning", round: 0, delta: "First block." }),
    ev({ type: "text", round: 0, delta: "Partial answer" }),
    ev({ type: "reasoning", round: 0, delta: "Second block." }),
    ev({ type: "text", round: 0, delta: " and more" }),
    ev({ type: "reasoning", round: 0, delta: "\n\n" }),
    ev({ type: "reasoning_status", round: 0, text: "Second status." }),
  ]);
  assert.deepEqual(
    reasoning_steps(state).map((step) => [step.text, step.status_line]),
    [
      ["First block.", undefined],
      ["Second block.", "Second status."],
      ["\n\n", undefined],
    ],
  );
  const ended = apply_events(state, [ev({ type: "end", status: "done", error: null })]);
  assert.deepEqual(
    reasoning_steps(ended).map((step) => [step.text, step.status_line]),
    [
      ["First block.", undefined],
      ["Second block.", "Second status."],
    ],
  );
});

test("a retry drops the reasoning step and its status with the failed attempt and an empty status is ignored", () => {
  seq = 0;
  const state = apply_events(message(), [
    ev({ type: "reasoning", round: 0, delta: "Reading config.json" }),
    ev({ type: "reasoning_status", round: 0, text: "Reading config.json." }),
    ev({ type: "retry", round: 0, attempt: 1, max: 9, reason: "provider unavailable", wait_ms: 1000 }),
    ev({ type: "reasoning_status", round: 0, text: "" }),
  ]);
  assert.deepEqual(state.steps, []);
});

test("agent journals keep reasoning status events", () => {
  const event = { type: "reasoning_status", round: 2, text: "Vergleicht die Berichte.", seq: 4, at: 9 };
  assert.deepEqual(parse_event(event, "chat-1"), event);
});

const user = (id: string, text: string, origin: UserMessage["origin"] = "user"): UserMessage => ({ id, role: "user", text, attachments: [], origin, created_at: "2026-10-06T00:00:00.000Z" });

const with_steers = (steps: AssistantMessage["steps"]): AssistantMessage => ({ ...message(), steps });

test("recent user texts are the last three human messages and steers, never app or agent notes", () => {
  const messages: Message[] = [
    user("u1", "first"),
    user("u2", "second"),
    user("u3", "agent report text", "agent_report"),
    with_steers([
      { id: "s1", round: 0, kind: "steer", text: "steer from the user", steer_id: "q1" },
      { id: "s2", round: 0, kind: "steer", text: "note from the main agent" },
    ]),
    user("u4", "   "),
    user("u5", "latest"),
  ];
  assert.deepEqual(recent_user_texts(messages), ["second", "steer from the user", "latest"]);
});

test("the status request carries the language, clipped user messages, the assignment and the reasoning tail", () => {
  const long = `${"a".repeat(1000)}MIDDLE${"z".repeat(1000)}`;
  const [system, request] = status_messages({ language: "de", user_texts: ["Fix the build", long], task: "Check the reports", reasoning: "Reading **Plan**", previous: "Liest die Logs." });
  assert.equal(system?.content, status_system);
  const content = request?.content ?? "";
  assert.match(content, /^LANGUAGE: German\n\nRECENT USER MESSAGES, oldest first:\n\[1\] Fix the build\n\n\[2\] a{600} \[\.\.\.\] z{600}\n\nSUB-AGENT ASSIGNMENT:\nCheck the reports/);
  assert.doesNotMatch(content, /MIDDLE/);
  assert.match(content, /CURRENT STATUS: Liest die Logs\.\n\nNEWEST REASONING \(may start mid-sentence\):\nReading \*\*Plan\*\*$/);
  const hidden = status_messages({ language: "en", user_texts: [], task: "", reasoning: "", previous: "" })[1]?.content ?? "";
  assert.equal(hidden, "LANGUAGE: English\n\nRECENT USER MESSAGES, oldest first:\n(none)\n\nCURRENT STATUS: (none yet)\n\nNEWEST REASONING: not visible, this provider hides it.");
});

test("a status reply is reduced to one plain line", () => {
  assert.equal(clean_status('  "**Comparing the two reports.**"\n'), "Comparing the two reports.");
  assert.equal(clean_status("Liest config.json\n und prüft den Pfad."), "Liest config.json und prüft den Pfad.");
  assert.equal(clean_status(""), "");
});
