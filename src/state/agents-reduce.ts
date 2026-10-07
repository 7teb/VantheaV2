import { apply_event, apply_events } from "../../shared/apply-event.ts";
import type { TurnStatus } from "../../shared/chat.ts";
import type { AgentEvent, TranscriptState } from "../../shared/events.ts";
import type { AgentRun, AgentRunStatus, AgentRunSummary, AgentSummary } from "../../shared/ipc/work.ts";

export type RunRef = { agent_id: string; run_id: string };

export type Transcript = TranscriptState & RunRef & { name: string; prompt: string; report: string; started_at: string };

type EntryBase = RunRef & { chat_id: string; request: number };

export type TranscriptEntry = EntryBase &
  ({ status: "loading"; held: AgentEvent[] } | { status: "ready"; transcript: Transcript } | { status: "failed" });

export type AgentsState = {
  chat_id: string | null;
  status: "idle" | "loading" | "ready" | "failed";
  agents: AgentSummary[];
  pending: boolean;
  held: AgentSummary[];
  transcript: TranscriptEntry | null;
};

export const empty_agents: AgentsState = { chat_id: null, status: "idle", agents: [], pending: false, held: [], transcript: null };

const turn_statuses: Record<AgentRunStatus, TurnStatus> = {
  running: "streaming",
  completed: "done",
  failed: "failed",
  cancelled: "stopped",
  interrupted: "interrupted",
};

const run_statuses: Record<TurnStatus, AgentRunStatus> = {
  streaming: "running",
  done: "completed",
  failed: "failed",
  blocked: "failed",
  stopped: "cancelled",
  interrupted: "interrupted",
};

export const run_status_of = (status: TurnStatus): AgentRunStatus => run_statuses[status];

const same_run = (left: RunRef, right: RunRef) => left.agent_id === right.agent_id && left.run_id === right.run_id;

const pick_run = (current: AgentRunSummary, incoming: AgentRunSummary) =>
  current.status !== "running" && incoming.status === "running" ? current : incoming;

const merge_runs = (current: AgentRunSummary[], incoming: AgentRunSummary[]): AgentRunSummary[] => {
  const merged = current.map((run) => {
    const next = incoming.find((entry) => entry.run_id === run.run_id);
    return next ? pick_run(run, next) : run;
  });
  const added = incoming.filter((run) => !current.some((entry) => entry.run_id === run.run_id));
  return [...merged, ...added];
};

const upsert_agent = (agents: AgentSummary[], summary: AgentSummary): AgentSummary[] => {
  const index = agents.findIndex((agent) => agent.agent_id === summary.agent_id);
  if (index === -1) {
    return [...agents, summary];
  }
  return agents.map((agent, position) => (position === index ? { ...summary, runs: merge_runs(agent.runs, summary.runs) } : agent));
};

export const begin_list = (state: AgentsState, chat_id: string | null): AgentsState => {
  const transcript = state.transcript && state.transcript.chat_id !== chat_id ? null : state.transcript;
  if (chat_id === null) {
    return { ...state, chat_id, status: "idle", agents: [], pending: false, held: [], transcript };
  }
  if (state.chat_id === chat_id && state.status === "ready") {
    return { ...state, pending: true, held: [], transcript };
  }
  return { ...state, chat_id, status: "loading", agents: [], pending: true, held: [], transcript };
};

export const finish_list = (state: AgentsState, chat_id: string, agents: AgentSummary[]): AgentsState => {
  if (state.chat_id !== chat_id || !state.pending) {
    return state;
  }
  return { ...state, status: "ready", agents: state.held.reduce(upsert_agent, agents), pending: false, held: [] };
};

export const fail_list = (state: AgentsState, chat_id: string): AgentsState => {
  if (state.chat_id !== chat_id || !state.pending) {
    return state;
  }
  if (state.status === "ready") {
    return { ...state, pending: false, held: [] };
  }
  return { ...state, status: "failed", agents: [], pending: false, held: [] };
};

export const receive_summary = (state: AgentsState, summary: AgentSummary): AgentsState => {
  if (summary.chat_id !== state.chat_id) {
    return state;
  }
  const agents = state.status === "ready" ? upsert_agent(state.agents, summary) : state.agents;
  const held = state.pending ? [...state.held, summary] : state.held;
  return agents === state.agents && held === state.held ? state : { ...state, agents, held };
};

const transcript_of = (run: AgentRun): Transcript => ({
  agent_id: run.agent_id,
  run_id: run.run_id,
  name: run.name,
  prompt: run.prompt,
  report: run.report,
  started_at: run.started_at,
  status: turn_statuses[run.status],
  steps: run.steps,
  reasoning_details: [],
  retry: run.retry,
  error: run.error,
  context: run.context,
  last_seq: run.last_seq,
  ended_at: run.ended_at,
});

const entry_base = (entry: TranscriptEntry): EntryBase => ({
  agent_id: entry.agent_id,
  run_id: entry.run_id,
  chat_id: entry.chat_id,
  request: entry.request,
});

export const open_transcript = (state: AgentsState, ref: RunRef, chat_id: string, request: number): AgentsState => ({
  ...state,
  transcript: { agent_id: ref.agent_id, run_id: ref.run_id, chat_id, request, status: "loading", held: [] },
});

export const finish_transcript = (state: AgentsState, request: number, run: AgentRun | null): AgentsState => {
  const entry = state.transcript;
  if (entry?.request !== request || entry.status !== "loading") {
    return state;
  }
  if (run === null) {
    return { ...state, transcript: { ...entry_base(entry), status: "failed" } };
  }
  return { ...state, transcript: { ...entry_base(entry), status: "ready", transcript: apply_events(transcript_of(run), entry.held) } };
};

export const fail_transcript = (state: AgentsState, request: number): AgentsState => {
  const entry = state.transcript;
  if (entry?.request !== request || entry.status !== "loading") {
    return state;
  }
  return { ...state, transcript: { ...entry_base(entry), status: "failed" } };
};

export const close_transcript = (state: AgentsState): AgentsState => (state.transcript === null ? state : { ...state, transcript: null });

export const receive_event = (state: AgentsState, event: AgentEvent): AgentsState => {
  const entry = state.transcript;
  if (!entry || !same_run(entry, event)) {
    return state;
  }
  if (entry.status === "loading") {
    return { ...state, transcript: { ...entry, held: [...entry.held, event] } };
  }
  if (entry.status === "failed") {
    return state;
  }
  const next = apply_event(entry.transcript, event);
  return next === entry.transcript ? state : { ...state, transcript: { ...entry, transcript: next } };
};

export const find_run = (agents: AgentSummary[], ref: RunRef): { agent: AgentSummary; run: AgentRunSummary } | null => {
  const agent = agents.find((entry) => entry.agent_id === ref.agent_id);
  const run = agent?.runs.find((entry) => entry.run_id === ref.run_id);
  return agent && run ? { agent, run } : null;
};

export const running_runs = (agents: AgentSummary[]) => agents.reduce((count, agent) => count + agent.runs.filter((run) => run.status === "running").length, 0);
