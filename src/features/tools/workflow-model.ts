import type { ToolStep } from "../../../shared/chat.ts";
import type { AgentProfile } from "../../../shared/ipc/work.ts";
import type { ToolView } from "../../../shared/tool-view.ts";
import { ended_agent, type WorkflowAgentEntry, type WorkflowAgentStatus, type WorkflowCounts, type WorkflowStatus, type WorkflowSummary } from "../../../shared/workflow.ts";
import type { MessageKey, Translate } from "../../i18n/translate.ts";
import type { RunRef } from "../../state/agents-reduce.ts";
import { format_duration, format_elapsed } from "./tool-summary.ts";

export type WorkflowToolView = Extract<ToolView, { kind: "workflow" }>;

export const workflow_view = (step: ToolStep): WorkflowToolView | null => (step.name === "run_workflow" && step.view?.kind === "workflow" ? step.view : null);

export const started_workflow = (step: ToolStep): string | null => workflow_view(step)?.run_id ?? null;

const run_labels: Record<WorkflowStatus, MessageKey> = {
  running: "workflow.label_running",
  completed: "workflow.label_completed",
  failed: "workflow.label_failed",
  stopped: "workflow.label_stopped",
  interrupted: "workflow.label_interrupted",
};

export const workflow_label = (t: Translate, name: string, status: WorkflowStatus | null): string => t(run_labels[status ?? "completed"], { x: name });

const end_labels: Record<Exclude<WorkflowStatus, "running">, MessageKey> = {
  completed: "agent.status_completed",
  failed: "agent.status_failed",
  stopped: "workflow.status_stopped",
  interrupted: "agent.status_interrupted",
};

export const end_label = (t: Translate, status: Exclude<WorkflowStatus, "running">): string => t(end_labels[status]);

export const row_tone = (status: WorkflowStatus | null): ToolStep["status"] => {
  switch (status) {
    case "running":
      return "running";
    case "failed":
    case "interrupted":
      return "failed";
    case "stopped":
      return "cancelled";
    default:
      return "done";
  }
};

export const agents_line = (t: Translate, summary: WorkflowSummary): string => {
  const total = summary.agents.length;
  if (total === 0) {
    return "";
  }
  if (summary.status === "running") {
    return t("workflow.agents_progress", { done: total - summary.counts.running, n: total });
  }
  return t(total === 1 ? "workflow.agents_one" : "workflow.agents_other", { n: total });
};

const count_keys: [keyof WorkflowCounts, MessageKey][] = [
  ["running", "workflow.count_running"],
  ["completed", "workflow.count_completed"],
  ["cached", "workflow.count_cached"],
  ["skipped", "workflow.count_skipped"],
  ["failed", "workflow.count_failed"],
  ["stopped", "workflow.count_stopped"],
];

export const counts_line = (t: Translate, counts: WorkflowCounts): string =>
  count_keys.flatMap(([field, key]) => (counts[field] > 0 ? [t(key, { n: counts[field] })] : [])).join(", ");

export const run_span = (summary: Pick<WorkflowSummary, "started_at" | "ended_at">): number | null => {
  const start = Date.parse(summary.started_at);
  const end = summary.ended_at === null ? Number.NaN : Date.parse(summary.ended_at);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
};

export type PhaseGroup = { key: string; title: string | null; detail: string; agents: WorkflowAgentEntry[]; done: number };

export const phase_groups = (summary: WorkflowSummary): PhaseGroup[] => {
  const groups = new Map<string, PhaseGroup>();
  for (const agent of [...summary.agents].sort((left, right) => left.index - right.index)) {
    const key = agent.phase === null ? "none" : `phase:${agent.phase}`;
    const group = groups.get(key) ?? { key, title: agent.phase, detail: summary.phases.find((phase) => phase.title === agent.phase)?.detail ?? "", agents: [], done: 0 };
    group.agents.push(agent);
    group.done += ended_agent(agent.status) ? 1 : 0;
    groups.set(key, group);
  }
  return [...groups.values()];
};

export const can_skip = (agent: WorkflowAgentEntry): boolean => agent.status === "starting" || agent.status === "running";

export const agent_transcript = (agent: WorkflowAgentEntry): RunRef | null =>
  agent.agent_id !== null && agent.agent_run_id !== null ? { agent_id: agent.agent_id, run_id: agent.agent_run_id } : null;

export const agent_ms = (agent: WorkflowAgentEntry, now: number): number | null => {
  if (agent.started_at === null) {
    return null;
  }
  const start = Date.parse(agent.started_at);
  const end = agent.ended_at !== null ? Date.parse(agent.ended_at) : ended_agent(agent.status) ? Number.NaN : now;
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
};

export const agent_time = (agent: WorkflowAgentEntry, now: number): string => {
  const ms = agent_ms(agent, now);
  if (ms === null) {
    return "";
  }
  return ended_agent(agent.status) ? format_duration(ms) : (format_elapsed(ms) ?? "");
};

const profile_roles: Record<AgentProfile, MessageKey> = { explore: "agent.profile_explore", worker: "agent.profile_worker" };

export const role_label = (t: Translate, role: string): string => {
  if (role === "explore" || role === "worker") {
    return t(profile_roles[role]);
  }
  return role === "inline" ? t("workflow.role_inline") : role;
};

const agent_keys: Partial<Record<WorkflowAgentStatus, MessageKey>> = {
  starting: "workflow.agent_starting",
  failed: "agent.status_failed",
  skipped: "workflow.agent_skipped",
  stopped: "workflow.status_stopped",
  interrupted: "agent.status_interrupted",
  cached: "workflow.agent_cached",
};

const status_word = (t: Translate, agent: WorkflowAgentEntry, waiting: boolean): string => {
  if (waiting && agent.status === "running") {
    return t("agent.waiting_approval");
  }
  const key = agent_keys[agent.status];
  return key ? t(key) : "";
};

export const agent_meta = (t: Translate, agent: WorkflowAgentEntry, now: number, waiting: boolean): string =>
  [role_label(t, agent.role), status_word(t, agent, waiting), agent_time(agent, now)].filter(Boolean).join(" · ");

export const agent_hint = (t: Translate, agent: WorkflowAgentEntry, model: string): string => {
  const tree = agent.worktree ? t(agent.worktree.kept ? "workflow.worktree_kept" : "workflow.worktree", { x: agent.worktree.branch }) : "";
  return [agent.label, [model, agent.effort].filter(Boolean).join(" · "), tree, agent.error].filter(Boolean).join("\n");
};

export const shown_error = (agent: WorkflowAgentEntry): string => (agent.status === "completed" || agent.status === "cached" ? "" : agent.error);

export type ApprovalScript = { script: string; args: string | null };

const args_marker = "\n\nargs: ";

export const split_workflow_approval = (text: string): ApprovalScript => {
  const at = text.lastIndexOf(args_marker);
  if (at < 0) {
    return { script: text, args: null };
  }
  const args = text.slice(at + args_marker.length);
  return { script: text.slice(0, at), args: args === "(no args)" ? null : args };
};
