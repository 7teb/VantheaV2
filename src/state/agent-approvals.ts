import type { AgentApproval, AgentApprovals } from "../../shared/ipc/work.ts";
import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";
import { on_active_chat } from "./ui.ts";

export type AgentApprovalsState = { chat_id: string | null; approvals: AgentApproval[] };

export const agent_approvals_store = create_store<AgentApprovalsState>({ chat_id: null, approvals: [] });

let ticket = 0;

const load = async (chat_id: string | null) => {
  const current = ++ticket;
  agent_approvals_store.set({ chat_id, approvals: [] });
  if (chat_id === null) {
    return;
  }
  try {
    const result = await api.invoke("agents:approvals", chat_id);
    if (current === ticket) {
      agent_approvals_store.set(result);
    }
  } catch (error) {
    console.error(`[agents] agents:approvals failed for chat ${chat_id}`, error);
  }
};

const receive = (update: AgentApprovals) => {
  if (agent_approvals_store.get().chat_id !== update.chat_id) {
    return;
  }
  ticket += 1;
  agent_approvals_store.set(update);
};

export const is_waiting = (state: AgentApprovalsState, run_id: string) => state.approvals.some((entry) => entry.run_id === run_id);

export const init_agent_approvals = (): (() => void) => {
  const stops = [api.on("agents:approvals_changed", receive), on_active_chat((chat_id) => void load(chat_id))];
  return () => {
    for (const stop of stops) {
      stop();
    }
  };
};
