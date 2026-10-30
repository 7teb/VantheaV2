import { createHash } from "node:crypto";
import {
  ended_agent,
  workflow_agent_statuses,
  workflow_counts,
  workflow_statuses,
  type WorkflowAgentEntry,
  type WorkflowLog,
  type WorkflowLogKind,
  type WorkflowPhase,
  type WorkflowSummary,
  type WorkflowWorktree,
} from "../../shared/workflow.ts";
import { as_array, as_iso, as_number, as_record, as_string, is_record, pick } from "../storage/coerce.ts";

export type StoredRun = { summary: WorkflowSummary; args_text: string; notice_due: boolean };

export type CallEndStatus = "completed" | "skipped" | "failed" | "stopped" | "interrupted";

export type JournalRecord = { index: number; kind: "agent" | "workflow"; key: string; end: { status: CallEndStatus; rank: number; result: unknown } | null };

export const run_id_pattern = /^wf_[A-Za-z0-9-]{8,80}$/;

export const app_closed_text = "The app closed while this workflow was running.";

const end_statuses: readonly CallEndStatus[] = ["completed", "skipped", "failed", "stopped", "interrupted"];

const log_kinds: readonly WorkflowLogKind[] = ["log", "caught", "note"];

const sorted = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sorted);
  }
  if (is_record(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, sorted(value[key])]),
    );
  }
  return value;
};

export const call_key = (parts: unknown[]): string => createHash("sha256").update(JSON.stringify(sorted(parts))).digest("hex");

const nullable_iso = (value: unknown, now: string): string | null => (typeof value === "string" ? as_iso(value, now) : null);

const parse_worktree = (value: unknown): WorkflowWorktree | null => {
  if (!is_record(value) || typeof value.path !== "string" || typeof value.branch !== "string") {
    return null;
  }
  return { path: value.path, branch: value.branch, kept: value.kept === true };
};

const parse_agent = (value: unknown, now: string): WorkflowAgentEntry | null => {
  const raw = as_record(value);
  if (typeof raw.index !== "number" || !Number.isInteger(raw.index) || raw.index < 0) {
    return null;
  }
  return {
    index: raw.index,
    label: as_string(raw.label, `agent ${raw.index + 1}`),
    phase: typeof raw.phase === "string" ? raw.phase : null,
    role: as_string(raw.role, "worker"),
    model: as_string(raw.model),
    effort: as_string(raw.effort),
    status: pick(raw.status, workflow_agent_statuses, "interrupted"),
    agent_id: typeof raw.agent_id === "string" ? raw.agent_id : null,
    agent_run_id: typeof raw.agent_run_id === "string" ? raw.agent_run_id : null,
    started_at: nullable_iso(raw.started_at, now),
    ended_at: nullable_iso(raw.ended_at, now),
    worktree: parse_worktree(raw.worktree),
    structured: raw.structured === true,
    preview: as_string(raw.preview),
    error: as_string(raw.error),
  };
};

const parse_phase = (value: unknown): WorkflowPhase | null => {
  const raw = as_record(value);
  return typeof raw.title === "string" ? { title: raw.title, detail: as_string(raw.detail), model: as_string(raw.model) } : null;
};

const parse_log = (value: unknown, now: string): WorkflowLog | null => {
  const raw = as_record(value);
  return typeof raw.text === "string" ? { at: as_iso(raw.at, now), kind: pick(raw.kind, log_kinds, "log"), text: raw.text } : null;
};

const present = <T>(value: T | null): value is T => value !== null;

export const mark_interrupted = (summary: WorkflowSummary, now: string, error: string): WorkflowSummary => {
  const agents = summary.agents.map((agent) => (ended_agent(agent.status) ? agent : { ...agent, status: "interrupted" as const, ended_at: now, error: agent.error || error }));
  return { ...summary, status: "interrupted", ended_at: now, error: summary.error || error, agents, counts: workflow_counts(agents) };
};

export const parse_state = (value: unknown, now: string): StoredRun | null => {
  const root = as_record(value);
  const raw = as_record(root.summary);
  const run_id = as_string(raw.run_id);
  const chat_id = as_string(raw.chat_id);
  if (!run_id_pattern.test(run_id) || !chat_id) {
    return null;
  }
  const agents = as_array(raw.agents).map((entry) => parse_agent(entry, now)).filter(present);
  const status = pick(raw.status, workflow_statuses, "interrupted");
  const summary: WorkflowSummary = {
    run_id,
    chat_id,
    name: as_string(raw.name, "workflow"),
    description: as_string(raw.description),
    when_to_use: as_string(raw.when_to_use),
    status,
    started_at: as_iso(raw.started_at, now),
    ended_at: nullable_iso(raw.ended_at, now),
    phases: as_array(raw.phases).map(parse_phase).filter(present),
    agents,
    logs: as_array(raw.logs).map((entry) => parse_log(entry, now)).filter(present),
    script_path: as_string(raw.script_path),
    resumed_from: typeof raw.resumed_from === "string" ? raw.resumed_from : null,
    result_preview: as_string(raw.result_preview),
    error: as_string(raw.error),
    parent_message_id: as_string(raw.parent_message_id),
    parent_call_id: as_string(raw.parent_call_id),
    counts: workflow_counts(agents),
  };
  const args_text = as_string(root.args_text);
  if (status !== "running") {
    return { summary, args_text, notice_due: root.notice_due === true };
  }
  return { summary: mark_interrupted(summary, now, app_closed_text), args_text, notice_due: true };
};

export const stored_state = (run: StoredRun) => ({ version: 1, summary: run.summary, args_text: run.args_text, notice_due: run.notice_due });

export const parse_journal = (lines: unknown[]): Map<number, JournalRecord> => {
  const records = new Map<number, JournalRecord>();
  for (const line of lines) {
    const raw = as_record(line);
    const index = as_number(raw.index, -1);
    if (!Number.isInteger(index) || index < 0) {
      continue;
    }
    if (raw.type === "call" && (raw.kind === "agent" || raw.kind === "workflow") && typeof raw.key === "string") {
      records.set(index, { index, kind: raw.kind, key: raw.key, end: null });
      continue;
    }
    const record = records.get(index);
    if (raw.type === "end" && record && !record.end) {
      record.end = { status: pick(raw.status, end_statuses, "interrupted"), rank: as_number(raw.rank, Number.MAX_SAFE_INTEGER), result: raw.result ?? null };
    }
  }
  return records;
};
