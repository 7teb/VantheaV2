import { scheduled_views } from "../../scheduled/store.ts";
import { define_tool } from "../types.ts";
import { scheduled_result, task_line } from "./common.ts";

export const list_scheduled_tasks_tool = define_tool<Record<string, never>>({
  spec: {
    name: "list_scheduled_tasks",
    description:
      "List all scheduled tasks with their ids, name, schedule, on/off state, model, permission mode, project, next run and last run result. Read-only, runs without approval. Call it before save_scheduled_task with an id or delete_scheduled_task.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  profiles: ["main"],
  concurrent: true,
  parse: () => ({}),
  run: async () => {
    const tasks = scheduled_views();
    const text = tasks.length ? `${tasks.length} scheduled ${tasks.length === 1 ? "task" : "tasks"} (id "name" schedule, on/off, model, mode, project, next run, last run):\n\n${tasks.map(task_line).join("\n")}` : "There are no scheduled tasks.";
    return scheduled_result("done", "list", text, tasks);
  },
});
