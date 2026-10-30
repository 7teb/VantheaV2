import { require_string } from "../storage/coerce.ts";
import { skip_workflow_agent, stop_workflow_run } from "../workflows/runtime.ts";
import { chat_runs, get_run, on_workflow_changed } from "../workflows/store.ts";
import { emit, handle } from "./handle.ts";

const id_of = (value: unknown, label: string) => require_string(value, label, 200);

const index_of = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("agent index must be a non-negative integer");
  }
  return value;
};

export const register_workflows_ipc = () => {
  on_workflow_changed((summary) => emit("workflows:changed", summary));
  handle("workflows:list", (chat_id) => chat_runs(id_of(chat_id, "chat id")));
  handle("workflows:get", (run_id) => get_run(id_of(run_id, "workflow run id"))?.summary ?? null);
  handle("workflows:stop", (run_id) => {
    stop_workflow_run(id_of(run_id, "workflow run id"), "user");
  });
  handle("workflows:skip_agent", (run_id, index) => {
    skip_workflow_agent(id_of(run_id, "workflow run id"), index_of(index));
  });
};
