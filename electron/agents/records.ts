import type { Sequenced, StreamEventBody } from "../../shared/events.ts";
import type { AgentProfile, AgentRunStatus, AgentRunSummary, AgentSummary } from "../../shared/ipc/work.ts";
import { as_array, as_iso, as_record, as_string, is_record, pick } from "../storage/coerce.ts";

export type RunRecord = AgentRunSummary & { parent_message_id: string };

export type AgentRecord = Omit<AgentSummary, "runs"> & {
  effort: string;
  project_root: string;
  created_at: string;
  updated_at: string;
  runs: RunRecord[];
};

export type StoredEvent = Sequenced & StreamEventBody;

export const max_stored_agents = 300;

const max_stored_runs = 50;

const statuses: readonly AgentRunStatus[] = ["running", "completed", "failed", "cancelled", "interrupted"];

const profiles: readonly AgentProfile[] = ["explore", "worker"];

const event_types: readonly StreamEventBody["type"][] = [
  "text",
  "reasoning",
  "reasoning_details",
  "retry",
  "tool_draft",
  "tool_call",
  "tool_start",
  "tool_progress",
  "tool_approval",
  "tool_end",
  "steer",
  "notice",
  "compaction",
  "context",
  "end",
];

const safe_id = /^[A-Za-z0-9_-]{1,100}$/;

export const public_run = (run: RunRecord): AgentRunSummary => ({
  run_id: run.run_id,
  prompt: run.prompt,
  status: run.status,
  started_at: run.started_at,
  ended_at: run.ended_at,
  report: run.report,
});

export const public_summary = (record: AgentRecord): AgentSummary => ({
  agent_id: record.agent_id,
  chat_id: record.chat_id,
  name: record.name,
  description: record.description,
  model: record.model,
  profile: record.profile,
  runs: record.runs.map(public_run),
});

export const current_run = (record: AgentRecord): RunRecord | null => record.runs.at(-1) ?? null;

export const is_running = (record: AgentRecord): boolean => current_run(record)?.status === "running";

export const newest_first = (a: AgentRecord, b: AgentRecord) => b.updated_at.localeCompare(a.updated_at);

export const trim_runs = (runs: RunRecord[]): RunRecord[] => runs.slice(-max_stored_runs);

export const stored_index = (records: Iterable<AgentRecord>) => ({ version: 1, agents: [...records].sort(newest_first) });

const parse_run = (value: unknown, now: string): RunRecord | null => {
  const raw = as_record(value);
  const run_id = as_string(raw.run_id);
  if (!safe_id.test(run_id)) {
    return null;
  }
  const status = pick(raw.status, statuses, "interrupted");
  const ended_at = typeof raw.ended_at === "string" ? as_iso(raw.ended_at, now) : null;
  return {
    run_id,
    prompt: as_string(raw.prompt),
    status: status === "running" ? "interrupted" : status,
    started_at: as_iso(raw.started_at, now),
    ended_at: status === "running" ? now : ended_at,
    report: as_string(raw.report),
    parent_message_id: as_string(raw.parent_message_id),
  };
};

const parse_agent = (value: unknown, now: string): AgentRecord | null => {
  const raw = as_record(value);
  const agent_id = as_string(raw.agent_id);
  const chat_id = as_string(raw.chat_id);
  if (!safe_id.test(agent_id) || !chat_id) {
    return null;
  }
  const runs = as_array(raw.runs)
    .map((entry) => parse_run(entry, now))
    .filter((run): run is RunRecord => run !== null);
  return {
    agent_id,
    chat_id,
    name: as_string(raw.name, "Agent"),
    description: as_string(raw.description),
    model: as_string(raw.model),
    effort: as_string(raw.effort),
    profile: pick(raw.profile, profiles, "explore"),
    project_root: as_string(raw.project_root),
    created_at: as_iso(raw.created_at, now),
    updated_at: as_iso(raw.updated_at, now),
    runs: trim_runs(runs),
  };
};

export const parse_index = (value: unknown, now: string): { records: AgentRecord[]; interrupted: number } => {
  const entries = as_array(as_record(value).agents);
  const records = entries
    .map((entry) => parse_agent(entry, now))
    .filter((record): record is AgentRecord => record !== null)
    .sort(newest_first)
    .slice(0, max_stored_agents);
  const interrupted = entries.flatMap((entry) => as_array(as_record(entry).runs)).filter((run) => as_record(run).status === "running").length;
  return { records, interrupted };
};

export const parse_event = (value: unknown): StoredEvent | null => {
  if (!is_record(value) || typeof value.seq !== "number" || typeof value.at !== "number") {
    return null;
  }
  return event_types.includes(value.type as StreamEventBody["type"]) ? (value as StoredEvent) : null;
};
