export type WorkflowStatus = "running" | "completed" | "failed" | "stopped" | "interrupted";

export type WorkflowAgentStatus = "starting" | "running" | "completed" | "failed" | "skipped" | "stopped" | "interrupted" | "cached";

export type WorkflowWorktree = { path: string; branch: string; kept: boolean };

export type WorkflowAgentEntry = {
  index: number;
  label: string;
  phase: string | null;
  role: string;
  model: string;
  effort: string;
  status: WorkflowAgentStatus;
  agent_id: string | null;
  agent_run_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  worktree: WorkflowWorktree | null;
  structured: boolean;
  preview: string;
  error: string;
};

export type WorkflowPhase = { title: string; detail: string; model: string };

export type WorkflowLogKind = "log" | "caught" | "note";

export type WorkflowLog = { at: string; kind: WorkflowLogKind; text: string };

export type WorkflowCounts = { completed: number; failed: number; skipped: number; stopped: number; cached: number; running: number };

export type WorkflowSummary = {
  run_id: string;
  chat_id: string;
  name: string;
  description: string;
  when_to_use: string;
  status: WorkflowStatus;
  started_at: string;
  ended_at: string | null;
  phases: WorkflowPhase[];
  agents: WorkflowAgentEntry[];
  logs: WorkflowLog[];
  script_path: string;
  resumed_from: string | null;
  result_preview: string;
  error: string;
  parent_message_id: string;
  parent_call_id: string;
  counts: WorkflowCounts;
};

export const workflow_statuses: readonly WorkflowStatus[] = ["running", "completed", "failed", "stopped", "interrupted"];

export const workflow_agent_statuses: readonly WorkflowAgentStatus[] = ["starting", "running", "completed", "failed", "skipped", "stopped", "interrupted", "cached"];

export const ended_agent = (status: WorkflowAgentStatus): boolean => status !== "starting" && status !== "running";

export const count_key = (status: WorkflowAgentStatus): keyof WorkflowCounts => {
  if (status === "completed" || status === "cached" || status === "skipped" || status === "stopped") return status;
  if (status === "failed" || status === "interrupted") return "failed";
  return "running";
};

export const workflow_counts = (agents: readonly Pick<WorkflowAgentEntry, "status">[]): WorkflowCounts => {
  const counts: WorkflowCounts = { completed: 0, failed: 0, skipped: 0, stopped: 0, cached: 0, running: 0 };
  for (const agent of agents) {
    counts[count_key(agent.status)] += 1;
  }
  return counts;
};

export const workflow_seconds = (summary: Pick<WorkflowSummary, "started_at" | "ended_at">, now = Date.now()): number => {
  const started = Date.parse(summary.started_at);
  const ended = summary.ended_at ? Date.parse(summary.ended_at) : now;
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, Math.round((ended - started) / 1000)) : 0;
};
