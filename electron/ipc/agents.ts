import type { AgentEvent } from "../../shared/events.ts";
import { live_run, on_agent_event, read_agent_run, waiting_approvals } from "../agents/live.ts";
import type { AgentRecord } from "../agents/records.ts";
import { agent_approval_key, cancel_agent } from "../agents/runner.ts";
import { get_agent, list_agents, on_agents_changed } from "../agents/store.ts";
import { resolve_decision } from "../permissions/approvals.ts";
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

const approval_events = new Set<AgentEvent["type"]>(["tool_approval", "tool_start", "tool_end", "end"]);

const published = new Map<string, string>();

const publish_approvals = (chat_id: string) => {
  const approvals = waiting_approvals(chat_id);
  const signature = approvals.map((entry) => `${entry.run_id}/${entry.call_id}`).join("|");
  if ((published.get(chat_id) ?? "") === signature) {
    return;
  }
  if (signature) {
    published.set(chat_id, signature);
  } else {
    published.delete(chat_id);
  }
  emit("agents:approvals_changed", { chat_id, approvals });
};

export const forget_chat_approvals = (chat_id: string): void => {
  published.delete(chat_id);
};

export const register_agents_ipc = () => {
  on_agents_changed((summary) => emit("agents:changed", summary));
  on_agent_event((event) => {
    emit("agent:event", event);
    const chat_id = approval_events.has(event.type) ? live_run(event.run_id)?.chat_id : undefined;
    if (chat_id) {
      publish_approvals(chat_id);
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
  handle("agents:approve", (agent_id, run_id, call_id, decision) => {
    const agent = agent_of(agent_id);
    const wanted = id_of(run_id, "run id");
    if (!agent.runs.some((entry) => entry.run_id === wanted)) {
      throw new Error(`run ${wanted} does not belong to agent ${agent.agent_id}`);
    }
    resolve_decision(agent_approval_key(wanted), id_of(call_id, "call id"), parse_decision(decision));
  });
};
