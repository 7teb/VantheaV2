import { delete_task } from "../../scheduled/edit.ts";
import { scheduled_task, view_of } from "../../scheduled/store.ts";
import { require_string } from "../browser/common.ts";
import { define_tool } from "../types.ts";
import { approve_change, card_of, scheduled_result, task_line, unknown_task } from "./common.ts";

export const delete_scheduled_task_tool = define_tool<{ id: string }>({
  spec: {
    name: "delete_scheduled_task",
    description: "Delete one scheduled task by its id from list_scheduled_tasks. Its chat stays as an ordinary chat with the history of its runs.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Id of the task, from list_scheduled_tasks." } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  parse: (raw) => ({ id: require_string(raw, "id").trim() }),
  run: async (ctx, args) => {
    const task = scheduled_task(args.id);
    const view = task ? view_of(task) : null;
    if (!view) {
      return unknown_task(args.id);
    }
    const refused = await approve_change(ctx, { kind: "scheduled_task", action: "delete", task: card_of(view), previous: null });
    if (refused) {
      return refused;
    }
    delete_task(view.id);
    return scheduled_result("done", "delete", `Deleted scheduled task ${task_line(view)}. Its chat stays as an ordinary chat with the history of its runs.`, [view]);
  },
});
