import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentRunStatus, AgentRunSummary, AgentSummary, BackgroundStatus, BackgroundTask } from "../shared/ipc/work.ts";
import type { WorkflowStatus, WorkflowSummary } from "../shared/workflow.ts";
import { group_tasks, type TaskEntry } from "../src/features/docks/background/task-groups.ts";

const run = (run_id: string, status: AgentRunStatus, started_at: string): AgentRunSummary => ({
  run_id,
  prompt: `prompt ${run_id}`,
  status,
  started_at,
  ended_at: status === "running" ? null : started_at,
  report: "",
  open_questions: 0,
});

const agent = (agent_id: string, runs: AgentRunSummary[]): AgentSummary => ({
  agent_id,
  chat_id: "c1",
  name: agent_id,
  description: "",
  topic: "",
  model: "model",
  effort: "high",
  profile: "explore",
  without_tools: [],
  runs,
});

const task = (id: string, status: BackgroundStatus, started_at: string): BackgroundTask => ({
  id,
  chat_id: "c1",
  name: id,
  command: `echo ${id}`,
  shell: "powershell",
  cwd: "D:/project",
  status,
  exit_code: status === "completed" ? 0 : null,
  started_at,
  ended_at: status === "running" ? null : started_at,
  output_tail: "",
});

const ids = (entries: TaskEntry[]) => entries.map((entry) => (entry.kind === "agent" ? entry.agent.agent_id : entry.kind === "workflow" ? entry.summary.run_id : entry.task.id));

test("agents and shell tasks split into running and finished, newest start first", () => {
  const agents = [
    agent("agent_old_done", [run("r1", "completed", "2026-10-14T08:00:00.000Z")]),
    agent("agent_live", [run("r2", "running", "2026-10-14T10:00:00.000Z")]),
  ];
  const tasks = [
    task("task_live", "running", "2026-10-14T11:00:00.000Z"),
    task("task_failed", "failed", "2026-10-14T09:00:00.000Z"),
    task("task_canceled", "cancelled", "2026-10-14T07:00:00.000Z"),
    task("task_live_old", "running", "2026-10-14T06:00:00.000Z"),
  ];
  const groups = group_tasks(agents, tasks);
  assert.deepEqual(ids(groups.running), ["task_live", "agent_live", "task_live_old"]);
  assert.deepEqual(ids(groups.finished), ["task_failed", "agent_old_done", "task_canceled"]);
});

test("an agent is running while any of its runs is running and sorts by its latest run", () => {
  const continued = agent("agent_continued", [
    run("r1", "completed", "2026-10-14T05:00:00.000Z"),
    run("r2", "running", "2026-10-14T12:00:00.000Z"),
  ]);
  const groups = group_tasks([continued], [task("task_mid", "running", "2026-10-14T08:00:00.000Z")]);
  assert.deepEqual(ids(groups.running), ["agent_continued", "task_mid"]);
  assert.deepEqual(groups.finished, []);
});

test("an agent whose runs all ended lands in finished even with an interrupted run", () => {
  const ended = agent("agent_ended", [
    run("r1", "interrupted", "2026-10-14T05:00:00.000Z"),
    run("r2", "failed", "2026-10-14T06:00:00.000Z"),
  ]);
  const groups = group_tasks([ended], []);
  assert.deepEqual(groups.running, []);
  assert.deepEqual(ids(groups.finished), ["agent_ended"]);
});

test("an agent without runs sorts after every timed entry", () => {
  const groups = group_tasks([agent("agent_empty", [])], [task("task_done", "completed", "2026-10-14T01:00:00.000Z")]);
  assert.deepEqual(ids(groups.finished), ["task_done", "agent_empty"]);
});

test("the entries keep the original summaries and the inputs stay untouched", () => {
  const agents = [agent("agent_a", [run("r1", "completed", "2026-10-14T01:00:00.000Z")])];
  const tasks = [task("task_a", "completed", "2026-10-14T02:00:00.000Z"), task("task_b", "completed", "2026-10-14T03:00:00.000Z")];
  const groups = group_tasks(agents, tasks);
  assert.deepEqual(
    tasks.map((entry) => entry.id),
    ["task_a", "task_b"],
  );
  const first = groups.finished[0];
  assert.equal(first.kind, "shell");
  assert.equal(first.kind === "shell" && first.task, tasks[1]);
  const last = groups.finished[2];
  assert.equal(last.kind === "agent" && last.agent, agents[0]);
});

test("nothing in, nothing out", () => {
  assert.deepEqual(group_tasks([], []), { running: [], finished: [] });
});

const workflow = (run_id: string, status: WorkflowStatus, started_at: string): WorkflowSummary => ({
  run_id,
  chat_id: "c1",
  name: run_id,
  description: "",
  when_to_use: "",
  status,
  started_at,
  ended_at: status === "running" ? null : started_at,
  phases: [],
  agents: [],
  logs: [],
  script_path: "",
  resumed_from: null,
  result_preview: "",
  error: "",
  parent_message_id: "m1",
  parent_call_id: "c1",
  counts: { completed: 0, failed: 0, skipped: 0, stopped: 0, cached: 0, running: 0 },
});

test("workflows are entries of their own and their agents are listed only inside them", () => {
  const inside = { ...agent("agent_in_wf", [run("r2", "running", "2026-10-14T09:05:00.000Z")]), workflow: { run_id: "wf_live", index: 0 } };
  const orphan = { ...agent("agent_old_wf", [run("r3", "completed", "2026-10-14T07:00:00.000Z")]), workflow: { run_id: "wf_gone", index: 0 } };
  const plain = agent("agent_plain", [run("r1", "running", "2026-10-14T09:10:00.000Z")]);
  const groups = group_tasks([inside, orphan, plain], [task("t1", "completed", "2026-10-14T08:00:00.000Z")], [
    workflow("wf_live", "running", "2026-10-14T09:00:00.000Z"),
    workflow("wf_done", "completed", "2026-10-14T08:30:00.000Z"),
  ]);
  assert.deepEqual(ids(groups.running), ["agent_plain", "wf_live"]);
  assert.deepEqual(ids(groups.finished), ["wf_done", "t1", "agent_old_wf"]);
});
