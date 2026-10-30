import type { PermissionMode } from "../../shared/chat.ts";
import type { Settings } from "../../shared/settings.ts";
import { count_key, type WorkflowAgentEntry, type WorkflowLogKind, type WorkflowSummary } from "../../shared/workflow.ts";
import type { AgentWorktree } from "./isolation.ts";
import type { RoleSpec, WorkflowMeta } from "./meta.ts";
import type { Replay } from "./replay.ts";
import type { RoleBook } from "./roles.ts";
import type { Sandbox } from "./sandbox.ts";
import { append_call, update_run } from "./store.ts";

export type WorkflowContext = {
  chat_id: string;
  parent_message_id: string;
  parent_call_id: string;
  project_root: string;
  project_path: string;
  user_request: string;
  mode: PermissionMode;
  settings: Settings;
  model_id: string;
  effort: string;
};

export type StopReason = "user" | "main" | "chat" | "app";

export type CallState = {
  index: number;
  id: number;
  kind: "agent" | "workflow";
  settled: boolean;
  skip: boolean;
  agent_id: string | null;
  worktree: AgentWorktree | null;
};

export type LiveWorkflow = {
  run_id: string;
  context: WorkflowContext;
  meta: WorkflowMeta;
  roles: RoleBook;
  sandbox: Sandbox | null;
  replay: Replay;
  calls: Map<number, CallState>;
  open_calls: number;
  entries: Map<number, WorkflowAgentEntry>;
  phase_titles: Set<string>;
  child_roles: Map<number, Record<string, RoleSpec>>;
  agent_count: number;
  next_rank: number;
  ended: boolean;
  notify: boolean;
  stop_reason: StopReason | null;
  persisted: Promise<string | null>;
  done: Promise<void>;
  finish: () => void;
};

const lives = new Map<string, LiveWorkflow>();

export const live_workflow = (run_id: string): LiveWorkflow | null => lives.get(run_id) ?? null;

export const live_workflows = (): LiveWorkflow[] => [...lives.values()];

export const track_live = (run: LiveWorkflow): void => {
  lives.set(run.run_id, run);
};

export const forget_live_workflow = (run_id: string): void => {
  lives.delete(run_id);
};

export const now_iso = () => new Date().toISOString();

export const patch_summary = (run: LiveWorkflow, edit: (summary: WorkflowSummary) => void, immediate = false): void => {
  update_run(run.run_id, edit, immediate);
};

export const open_call = (run: LiveWorkflow, call: CallState): void => {
  run.calls.set(call.index, call);
  run.open_calls += 1;
};

export const close_call = (run: LiveWorkflow, call: CallState): boolean => {
  if (call.settled) {
    return false;
  }
  call.settled = true;
  run.open_calls -= 1;
  return true;
};

export const patch_agent = (run: LiveWorkflow, index: number, change: Partial<WorkflowAgentEntry>): void => {
  const agent = run.entries.get(index);
  if (!agent) {
    return;
  }
  patch_summary(run, (summary) => {
    if (change.status !== undefined && change.status !== agent.status) {
      summary.counts[count_key(agent.status)] -= 1;
      summary.counts[count_key(change.status)] += 1;
    }
    Object.assign(agent, change);
  });
};

export const add_agent = (run: LiveWorkflow, entry: WorkflowAgentEntry): void => {
  run.entries.set(entry.index, entry);
  patch_summary(run, (summary) => {
    summary.agents.push(entry);
    summary.counts[count_key(entry.status)] += 1;
  });
};

export const add_log = (run: LiveWorkflow, kind: WorkflowLogKind, text: string): void =>
  patch_summary(run, (summary) => {
    summary.logs.push({ at: now_iso(), kind, text });
  });

export const add_phase = (run: LiveWorkflow, title: string | null, detail = "", model = ""): void => {
  if (title === null || run.phase_titles.has(title)) {
    return;
  }
  run.phase_titles.add(title);
  patch_summary(run, (summary) => {
    summary.phases.push({ title, detail, model });
  });
};

export const journal_end = (run: LiveWorkflow, index: number, status: string, result: unknown): number => {
  const rank = run.next_rank;
  run.next_rank += 1;
  append_call(run.run_id, { type: "end", index, status, rank, result });
  return rank;
};

export const preview_of = (value: unknown): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "null";
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
};
