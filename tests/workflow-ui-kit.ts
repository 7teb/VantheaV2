import type { ToolStep } from "../shared/chat.ts";
import type { ToolView } from "../shared/tool-view.ts";
import { workflow_counts, type WorkflowAgentEntry, type WorkflowAgentStatus, type WorkflowStatus, type WorkflowSummary } from "../shared/workflow.ts";

export const run_id = "wf_11111111-2222-3333-4444-555555555555";

export const at = (seconds: number) => new Date(Date.parse("2026-10-30T09:00:00.000Z") + seconds * 1000).toISOString();

export const agent_entry = (index: number, status: WorkflowAgentStatus, extra: Partial<WorkflowAgentEntry> = {}): WorkflowAgentEntry => ({
  index,
  label: `agent ${index}`,
  phase: null,
  role: "worker",
  model: "test/model",
  effort: "high",
  status,
  agent_id: status === "cached" ? null : `agent_${index}`,
  agent_run_id: status === "cached" ? null : `run_${index}`,
  started_at: status === "cached" ? null : at(index),
  ended_at: status === "starting" || status === "running" || status === "cached" ? null : at(index + 10),
  worktree: null,
  structured: false,
  preview: "",
  error: "",
  ...extra,
});

export const summary_of = (status: WorkflowStatus, agents: WorkflowAgentEntry[], extra: Partial<WorkflowSummary> = {}): WorkflowSummary => ({
  run_id,
  chat_id: "c1",
  name: "review-changes",
  description: "Review changed files and verify each finding",
  when_to_use: "",
  status,
  started_at: at(0),
  ended_at: status === "running" ? null : at(312),
  phases: [],
  agents,
  logs: [],
  script_path: "C:/data/workflows/runs/wf/script.js",
  resumed_from: null,
  result_preview: "",
  error: "",
  parent_message_id: "m1",
  parent_call_id: "call_1",
  counts: workflow_counts(agents),
  ...extra,
});

export const tool_step = (name: string, view: ToolView | null, status: ToolStep["status"] = "done", args: Record<string, unknown> = {}, id = `tool:${name}`): ToolStep => ({
  id,
  round: 1,
  kind: "tool",
  index: 0,
  call_id: `call_${id}`,
  name,
  args,
  status,
  progress: null,
  approval: null,
  view,
  error: null,
  result_text: "",
  started_at: 1000,
  ended_at: status === "done" || status === "failed" ? 2500 : null,
});

export const workflow_tool_view = (status: WorkflowStatus = "running"): Extract<ToolView, { kind: "workflow" }> => ({
  kind: "workflow",
  run_id,
  name: "review-changes",
  status,
  script_path: "C:/data/workflows/runs/wf/script.js",
});
