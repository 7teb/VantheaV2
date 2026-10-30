import { ended_agent, type WorkflowAgentEntry, type WorkflowStatus, type WorkflowSummary } from "../../shared/workflow.ts";

export type ListStatus = "idle" | "loading" | "ready" | "failed";

export type KnownRuns = Readonly<Record<string, WorkflowStatus>>;

export type WorkflowsState = {
  chat_id: string | null;
  status: ListStatus;
  request: number;
  pending: boolean;
  runs: Readonly<Record<string, WorkflowSummary>>;
  held: WorkflowSummary[];
  known: KnownRuns;
  open: string | null;
};

export const empty_workflows: WorkflowsState = { chat_id: null, status: "idle", request: 0, pending: false, runs: {}, held: [], known: {}, open: null };

const agent_stage = (agent: WorkflowAgentEntry): number => {
  if (ended_agent(agent.status)) {
    return 3;
  }
  return agent.status === "running" ? 2 : 1;
};

export const summary_progress = (summary: WorkflowSummary): number =>
  summary.agents.reduce((sum, agent) => sum + agent_stage(agent), 0) + summary.logs.length + summary.phases.length;

export const newer_summary = (current: WorkflowSummary, incoming: WorkflowSummary): WorkflowSummary => {
  if (current.status !== "running") {
    return incoming.status === "running" ? current : incoming;
  }
  if (incoming.status !== "running") {
    return incoming;
  }
  return summary_progress(incoming) < summary_progress(current) ? current : incoming;
};

const put = (runs: Readonly<Record<string, WorkflowSummary>>, summary: WorkflowSummary): Readonly<Record<string, WorkflowSummary>> => {
  const current = runs[summary.run_id];
  const next = current ? newer_summary(current, summary) : summary;
  return next === current ? runs : { ...runs, [summary.run_id]: next };
};

const know = (known: KnownRuns, summaries: readonly WorkflowSummary[]): KnownRuns => {
  let next = known;
  for (const summary of summaries) {
    const current = next[summary.run_id];
    if (current === summary.status || (current !== undefined && current !== "running" && summary.status === "running")) {
      continue;
    }
    next = { ...next, [summary.run_id]: summary.status };
  }
  return next;
};

export const begin_list = (state: WorkflowsState, chat_id: string | null, request: number): WorkflowsState => {
  if (chat_id === null) {
    return { ...empty_workflows, request, known: state.known };
  }
  if (state.chat_id === chat_id && state.status === "ready") {
    return { ...state, request, pending: true, held: [] };
  }
  return { chat_id, status: "loading", request, pending: true, runs: {}, held: [], known: state.known, open: null };
};

export const finish_list = (state: WorkflowsState, request: number, list: WorkflowSummary[]): WorkflowsState => {
  if (state.request !== request || !state.pending) {
    return state;
  }
  const own = list.filter((summary) => summary.chat_id === state.chat_id);
  const listed = Object.fromEntries(own.map((summary) => [summary.run_id, summary]));
  const runs = state.held.reduce(put, listed);
  return { ...state, status: "ready", pending: false, runs, held: [], known: know(state.known, Object.values(runs)) };
};

export const fail_list = (state: WorkflowsState, request: number): WorkflowsState => {
  if (state.request !== request || !state.pending) {
    return state;
  }
  return { ...state, status: state.status === "ready" ? "ready" : "failed", pending: false, held: [] };
};

export const receive_summary = (state: WorkflowsState, summary: WorkflowSummary): WorkflowsState => {
  const known = know(state.known, [summary]);
  if (summary.chat_id !== state.chat_id) {
    return known === state.known ? state : { ...state, known };
  }
  const runs = put(state.runs, summary);
  const held = state.pending ? [...state.held, summary] : state.held;
  return runs === state.runs && held === state.held && known === state.known ? state : { ...state, runs, held, known };
};

export const list_status = (state: WorkflowsState, chat_id: string): ListStatus => (state.chat_id === chat_id ? state.status : "loading");

export const run_status = (state: WorkflowsState, run_id: string): WorkflowStatus | null => state.runs[run_id]?.status ?? state.known[run_id] ?? null;

export const live_run = (state: WorkflowsState, run_ids: readonly string[]): WorkflowSummary | null => {
  for (const run_id of run_ids) {
    const summary = state.runs[run_id];
    if (summary?.status === "running") {
      return summary;
    }
  }
  return null;
};

export const holds_turn = (state: WorkflowsState, run_ids: readonly string[]): boolean => run_ids.some((run_id) => run_status(state, run_id) === "running");

export const show_run = (state: WorkflowsState, run_id: string | null): WorkflowsState => (state.open === run_id ? state : { ...state, open: run_id });
