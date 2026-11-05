import path from "node:path";
import type { WorkflowSummary } from "../shared/workflow.ts";
import type { ApiMessage, RoundResult } from "../electron/model/types.ts";
import type { WorkflowContext } from "../electron/workflows/live.ts";
import { settled_workflow, start_workflow, type Started } from "../electron/workflows/runtime.ts";
import type { JournalRecord } from "../electron/workflows/records.ts";
import { inline_source } from "../electron/workflows/saved.ts";
import { get_run, init_workflow_store } from "../electron/workflows/store.ts";
import { completed, model, project, root, settings, start_runner } from "./agents-runner-harness.ts";

export const head = (name = "wf-test") => `export const meta = { name: '${name}', description: 'a workflow under test', phases: [{ title: 'Scan', detail: 'scan things' }] }\n`;

export const context = (chat_id: string): WorkflowContext => ({
  chat_id,
  parent_message_id: `turn-${chat_id}`,
  parent_call_id: `call-${chat_id}`,
  project_root: project,
  project_path: project,
  user_request: "the user's request",
  mode: "auto",
  settings,
  model_id: model.id,
  effort: "",
});

export const workflows_dir = () => path.join(root, "workflows");

export const start_workflows = async (): Promise<void> => {
  await start_runner();
  await init_workflow_store(workflows_dir());
};

export const launch = (chat_id: string, body: string, args: unknown = undefined, resume: { run_id: string; journal: Map<number, JournalRecord> } | null = null, name = "wf-test"): Promise<Started> =>
  start_workflow({ context: context(chat_id), source: inline_source(`${head(name)}${body}`), args: args === undefined ? { present: false, value: undefined } : { present: true, value: args }, resume });

export const launch_source = (chat_id: string, source: string, args: unknown = undefined, resume: { run_id: string; journal: Map<number, JournalRecord> } | null = null): Promise<Started> =>
  start_workflow({ context: context(chat_id), source: inline_source(source), args: args === undefined ? { present: false, value: undefined } : { present: true, value: args }, resume });

export const wait_until = async (check: () => boolean, what: string, ms = 8000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

export const summary = (run_id: string): WorkflowSummary => {
  const run = get_run(run_id);
  if (!run) {
    throw new Error(`no run ${run_id}`);
  }
  return run.summary;
};

export const ended = async (run_id: string): Promise<WorkflowSummary> => {
  await wait_until(() => summary(run_id).status !== "running", `run ${run_id} to end`);
  await settled_workflow(run_id);
  return summary(run_id);
};

export const result_call = (args: Record<string, unknown>, id = `res_${Math.round(Math.random() * 1e9)}`): RoundResult =>
  completed({ tool_calls: [{ index: 0, id, name: "structured_result", arguments: JSON.stringify(args) }], finish_reason: "tool_calls" });

export const contents = (messages: ApiMessage[]): string[] => messages.map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)));

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
