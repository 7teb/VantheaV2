import type { ApprovalDecision } from "../../shared/approval.ts";
import { api } from "../api/bridge.ts";
import {
  begin_list,
  close_transcript,
  empty_agents,
  fail_list,
  fail_transcript,
  finish_list,
  finish_transcript,
  open_transcript,
  receive_event,
  receive_summary,
  type AgentsState,
  type RunRef,
} from "./agents-reduce.ts";
import type { ActionResult } from "./chat-actions.ts";
import { create_store } from "./create-store.ts";
import { toggle_dock, ui_store } from "./ui.ts";

export const agents_store = create_store<AgentsState>(empty_agents);

let transcript_request = 0;

const failure = (error: unknown): ActionResult => ({ ok: false, error: error instanceof Error ? error.message : String(error) });

export const load_agents = async (chat_id: string | null) => {
  agents_store.update((state) => begin_list(state, chat_id));
  if (chat_id === null) {
    return;
  }
  try {
    const agents = await api.invoke("agents:list", chat_id);
    agents_store.update((state) => finish_list(state, chat_id, agents));
  } catch (error) {
    console.error(`[agents] agents:list failed for chat ${chat_id}`, error);
    agents_store.update((state) => fail_list(state, chat_id));
  }
};

const load_run = async (ref: RunRef, chat_id: string) => {
  const request = ++transcript_request;
  agents_store.update((state) => open_transcript(state, ref, chat_id, request));
  try {
    const run = await api.invoke("agents:run", ref.agent_id, ref.run_id);
    agents_store.update((state) => finish_transcript(state, request, run));
  } catch (error) {
    console.error(`[agents] agents:run failed for agent ${ref.agent_id} run ${ref.run_id}`, error);
    agents_store.update((state) => fail_transcript(state, request));
  }
};

export const select_agent_run = (ref: RunRef) => {
  const chat_id = agents_store.get().chat_id;
  if (chat_id !== null) {
    void load_run(ref, chat_id);
  }
};

export const open_agent_run = (ref: RunRef) => {
  const ui = ui_store.get();
  if (ui.active_chat_id === null) {
    return;
  }
  void load_run(ref, ui.active_chat_id);
  if (ui.dock.kind !== "agents") {
    toggle_dock("agents");
  }
};

export const close_agent_run = () => agents_store.update(close_transcript);

export const cancel_agent = async (agent_id: string): Promise<ActionResult> => {
  try {
    await api.invoke("agents:cancel", agent_id);
    return { ok: true };
  } catch (error) {
    console.error(`[agents] agents:cancel failed for agent ${agent_id}`, error);
    return failure(error);
  }
};

export const answer_agent_approval = async (ref: RunRef, call_id: string, decision: ApprovalDecision): Promise<ActionResult> => {
  try {
    await api.invoke("agents:approve", ref.agent_id, ref.run_id, call_id, decision);
    return { ok: true };
  } catch (error) {
    console.error(`[agents] agents:approve failed for agent ${ref.agent_id} run ${ref.run_id} call ${call_id}`, error);
    return failure(error);
  }
};

export const init_agents = (): (() => void) => {
  const stops = [
    api.on("agents:changed", (summary) => agents_store.update((state) => receive_summary(state, summary))),
    api.on("agent:event", (event) => agents_store.update((state) => receive_event(state, event))),
  ];
  return () => {
    for (const stop of stops) {
      stop();
    }
  };
};
