import type { WorkflowSummary } from "../../../shared/workflow.ts";
import { use_store } from "../../state/use-store.ts";
import { live_run } from "../../state/workflows-reduce.ts";
import { workflows_store } from "../../state/workflows.ts";
import { started_workflow } from "./workflow-model.ts";
import { work_tools, type WorkStep } from "./work-steps.ts";

export const use_live_workflow = (steps: WorkStep[]): WorkflowSummary | null => {
  const run_ids = work_tools(steps).flatMap((step) => started_workflow(step) ?? []);
  return use_store(workflows_store, (state) => live_run(state, run_ids));
};
