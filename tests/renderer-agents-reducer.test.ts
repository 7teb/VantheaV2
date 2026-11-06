import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentEvent, StreamEventBody } from "../shared/events.ts";
import type { AgentRun, AgentRunSummary, AgentSummary } from "../shared/ipc/work.ts";
import {
  begin_list,
  close_transcript,
  empty_agents,
  fail_transcript,
  finish_list,
  finish_transcript,
  open_transcript,
  receive_event,
  receive_summary,
  run_status_of,
  type AgentsState,
  type Transcript,
} from "../src/state/agents-reduce.ts";

const ref = { agent_id: "ag1", run_id: "r1" };

const run = (last_seq = 0, steps: AgentRun["steps"] = []): AgentRun => ({
  agent_id: "ag1",
  run_id: "r1",
  name: "scout",
  prompt: "look around",
  status: "running",
  started_at: "2026-10-06T10:00:00.000Z",
  ended_at: null,
  report: "",
  open_questions: 0,
  steps,
  retry: null,
  error: null,
  context: null,
  last_seq,
});

const event = (seq: number, body: StreamEventBody, target = ref): AgentEvent => ({ ...body, seq, at: 1000 + seq, ...target }) as AgentEvent;

const text = (seq: number, delta: string, target = ref) => event(seq, { type: "text", round: 1, delta }, target);

const ready = (state: AgentsState): Transcript => {
  const entry = state.transcript;
  assert.ok(entry && entry.status === "ready", "transcript is ready");
  return entry.transcript;
};

const text_of = (transcript: Transcript) => transcript.steps.flatMap((step) => (step.kind === "text" ? [step.text] : [])).join("|");

const opened = (request = 1) => open_transcript(empty_agents, ref, "c1", request);

test("events that arrive before the run loads are buffered and applied after it", () => {
  let state = opened();
  state = receive_event(state, text(1, "a"));
  state = receive_event(state, text(2, "b"));
  state = receive_event(state, text(3, "c"));
  assert.equal(state.transcript?.status, "loading");
  state = finish_transcript(state, 1, run(2, [{ id: "text:1", round: 1, kind: "text", text: "ab" }]));
  const transcript = ready(state);
  assert.equal(text_of(transcript), "abc");
  assert.equal(transcript.last_seq, 3);
  assert.equal(transcript.status, "streaming");
});

test("live events are deduplicated by seq", () => {
  let state = finish_transcript(opened(), 1, run());
  state = receive_event(state, text(1, "a"));
  state = receive_event(state, text(2, "b"));
  const before = state;
  state = receive_event(state, text(2, "b"));
  state = receive_event(state, text(1, "a"));
  assert.equal(state, before);
  assert.equal(text_of(ready(state)), "ab");
});

test("events of other runs are ignored", () => {
  const state = finish_transcript(opened(), 1, run());
  assert.equal(receive_event(state, text(1, "x", { agent_id: "ag1", run_id: "r2" })), state);
  assert.equal(receive_event(state, text(1, "x", { agent_id: "ag2", run_id: "r1" })), state);
  const closed = close_transcript(state);
  assert.equal(receive_event(closed, text(1, "x")), closed);
});

test("an end event settles the transcript and maps to a run status", () => {
  let state = finish_transcript(opened(), 1, run());
  state = receive_event(state, event(1, { type: "tool_call", round: 1, index: 0, call_id: "c", name: "read_file", args: {} }));
  state = receive_event(state, event(2, { type: "end", status: "done", error: null }));
  const transcript = ready(state);
  assert.equal(transcript.status, "done");
  assert.equal(run_status_of(transcript.status), "completed");
  assert.equal(transcript.steps[0].kind === "tool" && transcript.steps[0].status, "cancelled");
});

test("a stale load does not replace a newer selection", () => {
  let state = opened(1);
  state = open_transcript(state, { agent_id: "ag2", run_id: "r9" }, "c1", 2);
  assert.equal(finish_transcript(state, 1, run()), state);
  assert.equal(fail_transcript(state, 1), state);
  assert.equal(finish_transcript(state, 2, null).transcript?.status, "failed");
  assert.equal(fail_transcript(state, 2).transcript?.status, "failed");
});

const summary_run = (status: AgentRunSummary["status"], run_id = "r1"): AgentRunSummary => ({
  run_id,
  prompt: "p",
  status,
  started_at: "2026-10-06T10:00:00.000Z",
  ended_at: status === "running" ? null : "2026-10-06T10:01:00.000Z",
  report: status === "completed" ? "done" : "",
  open_questions: 0,
});

const summary = (runs: AgentRunSummary[], chat_id = "c1", agent_id = "ag1"): AgentSummary => ({
  agent_id,
  chat_id,
  name: "scout",
  description: "",
  topic: "",
  model: "m",
  effort: "high",
  profile: "explore",
  without_tools: [],
  runs,
});

test("summaries during a list load are held and merged without regressing finished runs", () => {
  let state = begin_list(empty_agents, "c1");
  state = receive_summary(state, summary([summary_run("completed")]));
  state = receive_summary(state, summary([summary_run("running")], "c2", "other"));
  assert.equal(state.status, "loading");
  state = finish_list(state, "c1", [summary([summary_run("running")]), summary([], "c1", "ag2")]);
  assert.equal(state.status, "ready");
  assert.deepEqual(
    state.agents.map((agent) => [agent.agent_id, agent.runs.map((entry) => entry.status)]),
    [
      ["ag1", ["completed"]],
      ["ag2", []],
    ],
  );
  state = receive_summary(state, summary([summary_run("completed"), summary_run("running", "r2")]));
  assert.deepEqual(state.agents[0].runs.map((entry) => entry.run_id), ["r1", "r2"]);
});

test("a list for another chat drops a transcript opened in a different chat", () => {
  const loaded = finish_transcript(opened(), 1, run());
  assert.equal(begin_list(loaded, "c1").transcript, loaded.transcript);
  assert.equal(begin_list(loaded, "c2").transcript, null);
  assert.equal(finish_list(begin_list(loaded, "c2"), "c1", []).status, "loading");
});

test("run statuses are kept for every chat across list loads and never fall back to running", () => {
  let state = begin_list(empty_agents, "c1");
  state = receive_summary(state, summary([summary_run("running", "r7")], "c2", "ag7"));
  assert.equal(state.known_runs.r7?.status, "running");
  assert.deepEqual(state.held, []);
  state = begin_list(state, "c2");
  assert.deepEqual(state.agents, []);
  assert.equal(state.known_runs.r7?.status, "running");
  state = receive_summary(state, summary([summary_run("completed", "r7")], "c2", "ag7"));
  state = finish_list(state, "c2", [summary([summary_run("running", "r7")], "c2", "ag7")]);
  assert.equal(state.known_runs.r7?.status, "completed");
  assert.equal(state.agents[0].runs[0].status, "completed");
});
