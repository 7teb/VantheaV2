import { api } from "../api/bridge.ts";
import { close_agent_run } from "./agents.ts";
import { failure, type ActionResult } from "./chat-actions.ts";
import { create_store } from "./create-store.ts";
import { on_active_chat, toggle_dock, ui_store } from "./ui.ts";
import { begin_list, empty_workflows, fail_list, finish_list, receive_summary, show_run, type WorkflowsState } from "./workflows-reduce.ts";

export const workflows_store = create_store<WorkflowsState>(empty_workflows);

export const open_workflow = (run_id: string) => {
  workflows_store.update((state) => show_run(state, run_id));
  close_agent_run();
  if (ui_store.get().dock.kind !== "background") {
    toggle_dock("background");
  }
};

export const close_workflow = () => workflows_store.update((state) => show_run(state, null));

let request = 0;

export const load_workflows = async (chat_id: string | null) => {
  const ticket = ++request;
  workflows_store.update((state) => begin_list(state, chat_id, ticket));
  if (chat_id === null) {
    return;
  }
  try {
    const runs = await api.invoke("workflows:list", chat_id);
    workflows_store.update((state) => finish_list(state, ticket, runs));
  } catch (error) {
    console.error(`[workflows] workflows:list failed for chat ${chat_id}`, error);
    workflows_store.update((state) => fail_list(state, ticket));
  }
};

export const stop_workflow = async (run_id: string): Promise<ActionResult> => {
  try {
    await api.invoke("workflows:stop", run_id);
    return { ok: true };
  } catch (error) {
    console.error(`[workflows] workflows:stop failed for run ${run_id}`, error);
    return failure(error);
  }
};

export const skip_workflow_agent = async (run_id: string, index: number): Promise<ActionResult> => {
  try {
    await api.invoke("workflows:skip_agent", run_id, index);
    return { ok: true };
  } catch (error) {
    console.error(`[workflows] workflows:skip_agent failed for run ${run_id} agent ${index}`, error);
    return failure(error);
  }
};

export const init_workflows = (): (() => void) => {
  const stops = [
    api.on("workflows:changed", (summary) => workflows_store.update((state) => receive_summary(state, summary))),
    on_active_chat((chat_id) => void load_workflows(chat_id)),
  ];
  return () => {
    for (const stop of stops) {
      stop();
    }
  };
};
