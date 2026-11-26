import { agent_approval_key, on_agent_event, read_agent_run, waiting_approvals } from "../agents/live.ts";
import type { AgentRecord } from "../agents/records.ts";
import { cancel_agent } from "../agents/runner.ts";
import { get_agent, list_agents, on_agents_changed } from "../agents/store.ts";
import { hold_decision, on_approval_changed, resolve_decision } from "../permissions/approvals.ts";
import { require_string } from "../storage/coerce.ts";
import { emit, handle } from "./handle.ts";
import { parse_decision } from "./turn.ts";

const id_of = (value: unknown, label: string) => require_string(value, label, 200);

const agent_of = (value: unknown): AgentRecord => {
  const agent_id = id_of(value, "agent id");
  const agent = get_agent(agent_id);
  if (!agent) {
    throw new Error(`agent ${agent_id} not found`);
  }
  return agent;
};

const run_approval_key = (agent_id: unknown, run_id: unknown): string | null => {
  const agent = get_agent(id_of(agent_id, "agent id"));
  const wanted = id_of(run_id, "run id");
  return agent?.runs.some((entry) => entry.run_id === wanted) ? agent_approval_key(wanted) : null;
};

export const register_agents_ipc = () => {
  on_agents_changed((summary) => emit("agents:changed", summary));
  on_agent_event((event) => emit("agent:event", event));
  on_approval_changed((chat_id, key) => {
    if (key !== chat_id) {
      emit("agents:approvals_changed", { chat_id, approvals: waiting_approvals(chat_id) });
    }
  });
  handle("agents:approvals", (chat_id) => {
    const id = id_of(chat_id, "chat id");
    return { chat_id: id, approvals: waiting_approvals(id) };
  });
  handle("agents:list", (chat_id) => list_agents(id_of(chat_id, "chat id")));
  handle("agents:run", (agent_id, run_id) => {
    const agent = agent_of(agent_id);
    const wanted = id_of(run_id, "run id");
    const run = agent.runs.find((entry) => entry.run_id === wanted);
    return run ? read_agent_run(agent, run) : null;
  });
  handle("agents:cancel", (agent_id) => {
    cancel_agent(agent_of(agent_id));
  });
  handle("agents:approve", (agent_id, run_id, request_id, decision) => {
    const key = run_approval_key(agent_id, run_id);
    return key !== null && resolve_decision(key, id_of(request_id, "approval request id"), parse_decision(decision));
  });
  handle("agents:hold_approval", (agent_id, run_id, request_id) => {
    const key = run_approval_key(agent_id, run_id);
    return key !== null && hold_decision(key, id_of(request_id, "approval request id"));
  });
};
