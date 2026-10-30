import { workflow_counts } from "../../../shared/workflow.ts";
import { run_id_pattern } from "../../workflows/records.ts";
import { stop_workflow_run } from "../../workflows/runtime.ts";
import { get_run } from "../../workflows/store.ts";
import { require_string } from "../browser/common.ts";
import { guarded } from "../fs/common.ts";
import { define_tool, ToolArgumentError } from "../types.ts";
import { stop_workflow_description } from "./text.ts";

export const stop_workflow_tool = define_tool<{ run_id: string }>({
  spec: {
    name: "stop_workflow",
    description: stop_workflow_description,
    parameters: {
      type: "object",
      properties: { run_id: { type: "string", description: "The workflow run id (wf_...) from run_workflow." } },
      required: ["run_id"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  parse: (raw) => {
    const run_id = require_string(raw, "run_id").trim();
    if (!run_id_pattern.test(run_id)) {
      throw new ToolArgumentError("run_id must be a workflow run id like wf_...");
    }
    return { run_id };
  },
  run: (ctx, args) =>
    guarded(ctx, "stop_workflow", async () => {
      const stored = get_run(args.run_id);
      if (!stored || stored.summary.chat_id !== ctx.chat_id) {
        throw new Error(`No workflow run ${args.run_id} exists in this chat.`);
      }
      const view = { kind: "workflow" as const, run_id: args.run_id, name: stored.summary.name, status: stored.summary.status, script_path: stored.summary.script_path };
      if (!stop_workflow_run(args.run_id, "main")) {
        return { status: "done", text: `Workflow ${stored.summary.name} (run ${args.run_id}) is not running (${stored.summary.status}); nothing was stopped.`, view };
      }
      const summary = get_run(args.run_id)?.summary ?? stored.summary;
      const counts = workflow_counts(summary.agents);
      return {
        status: "done",
        text: `Stopped workflow ${summary.name} (run ${args.run_id}). ${counts.stopped} running agent${counts.stopped === 1 ? " was" : "s were"} stopped; ${counts.completed + counts.cached} agent result${counts.completed + counts.cached === 1 ? " is" : "s are"} journaled. Resume it with run_workflow and resume_from ${args.run_id}.`,
        view: { ...view, status: summary.status },
      };
    }),
});
