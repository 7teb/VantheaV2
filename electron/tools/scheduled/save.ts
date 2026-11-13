import { schedule_intervals, type ScheduleInterval, type ScheduledAction, type ScheduledInput } from "../../../shared/scheduled.ts";
import { chat_meta } from "../../chats/store.ts";
import { change_task, create_task, type TaskPatch } from "../../scheduled/edit.ts";
import { scheduled_task, view_of } from "../../scheduled/store.ts";
import { max_name_chars } from "../../scheduled/validate.ts";
import { read_string } from "../browser/common.ts";
import { define_tool, ToolArgumentError, type ToolContext, type ToolResult } from "../types.ts";
import { approval_rule, approve_change, card_of, failed, scheduled_result, task_line, unknown_task, views_of } from "./common.ts";

type SaveArgs = { id: string | null; name: string | null; prompt: string | null; interval: ScheduleInterval | null; enabled: boolean | null };

const parameter_names = new Set(["id", "name", "prompt", "schedule", "enabled"]);

const parse_save = (raw: Record<string, unknown>): SaveArgs => {
  const unknown = Object.keys(raw).filter((key) => !parameter_names.has(key));
  if (unknown.length) {
    throw new ToolArgumentError(
      `unknown parameter ${unknown.join(", ")}; a new task takes the model, effort, permission mode and project of this chat, and only the user changes them later in the Scheduled tasks page`,
    );
  }
  const schedule = read_string(raw, "schedule");
  const interval = schedule === null ? null : (schedule_intervals.find((entry) => entry === schedule) ?? null);
  if (schedule !== null && !interval) {
    throw new ToolArgumentError(`schedule must be one of ${schedule_intervals.join(", ")}`);
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
    throw new ToolArgumentError("enabled must be a boolean");
  }
  const name = read_string(raw, "name")?.trim() || null;
  if (name !== null && name.length > max_name_chars) {
    throw new ToolArgumentError(`name is longer than ${max_name_chars} characters`);
  }
  return {
    id: read_string(raw, "id")?.trim() || null,
    name,
    prompt: read_string(raw, "prompt")?.trim() || null,
    interval,
    enabled: raw.enabled ?? null,
  };
};

const create = async (ctx: ToolContext, { name, prompt, interval, enabled }: SaveArgs): Promise<ToolResult> => {
  if (name === null || prompt === null || interval === null) {
    const missing = [name === null && "name", prompt === null && "prompt", interval === null && "schedule"].filter(Boolean);
    return failed(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required when creating a scheduled task. Nothing was changed.`);
  }
  const meta = chat_meta(ctx.chat_id);
  if (!meta?.choice) {
    return failed("This chat has no model choice a scheduled task could take over. Nothing was changed.");
  }
  const input: ScheduledInput = { name, prompt, interval, enabled: enabled ?? true, choice: meta.choice, mode: ctx.mode, project_path: meta.project_path };
  const refused = await approve_change(ctx, { kind: "scheduled_task", action: "create", task: card_of(input), previous: null });
  if (refused) {
    return refused;
  }
  const tasks = views_of([await create_task(input)]);
  const start = input.enabled ? "Its first run starts right away" : "It is off, so it does not run until it is turned on";
  return scheduled_result("done", "create", `Created scheduled task ${tasks.map(task_line).join("")}. ${start}, in its own chat; runs with nothing new stay silent.`, tasks);
};

const action_of = (current: ScheduledInput, next: ScheduledInput): ScheduledAction | null => {
  if (next.name !== current.name || next.prompt !== current.prompt || next.interval !== current.interval) {
    return "change";
  }
  if (next.enabled === current.enabled) {
    return null;
  }
  return next.enabled ? "enable" : "disable";
};

const change = async (ctx: ToolContext, id: string, args: SaveArgs): Promise<ToolResult> => {
  const task = scheduled_task(id);
  const view = task ? view_of(task) : null;
  if (!view) {
    return unknown_task(id);
  }
  const patch: TaskPatch = {
    ...(args.name === null ? {} : { name: args.name }),
    ...(args.prompt === null ? {} : { prompt: args.prompt }),
    ...(args.interval === null ? {} : { interval: args.interval }),
    ...(args.enabled === null ? {} : { enabled: args.enabled }),
  };
  const current: ScheduledInput = { ...view };
  const next: ScheduledInput = { ...current, ...patch };
  const action = action_of(current, next);
  if (!action) {
    return scheduled_result("done", "change", `Scheduled task ${task_line(view)} already has these values. Nothing was changed.`, [view]);
  }
  const previous = action === "change" ? card_of(current) : null;
  const refused = await approve_change(ctx, { kind: "scheduled_task", action, task: card_of(next), previous });
  if (refused) {
    return refused;
  }
  const tasks = views_of([await change_task(id, patch)]);
  return scheduled_result("done", action, `Saved scheduled task ${tasks.map(task_line).join("")}.`, tasks, previous);
};

export const save_scheduled_task_tool = define_tool<SaveArgs>({
  spec: {
    name: "save_scheduled_task",
    description: [
      "Create or change a scheduled task. A scheduled task is a prompt VantheaX runs on its own, again and again on a fixed schedule, each run as a new turn in the task's own chat; the model compares with the earlier runs there and the user is notified only when a run finds something new.",
      "Use it when the user asks to check, watch or report something regularly.",
      "Runs happen only while VantheaX is open (also in the system tray). The first run starts right away; runs with nothing new stay silent.",
      "Without id it creates a task (name, prompt and schedule required) with this chat's model, effort, permission mode and project; with id it changes only the fields you pass, and passing only enabled turns the task on or off.",
      approval_rule,
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id from list_scheduled_tasks of the task to change. Leave it out to create a task." },
        name: { type: "string", description: "Short name; it is also the title of the task's chat. Required on create." },
        prompt: { type: "string", description: "The instruction every run gets. Each run only sees the task's own chat, not this chat, so write it self-contained. Required on create." },
        schedule: { type: "string", enum: [...schedule_intervals], description: "Required on create." },
        enabled: { type: "boolean", description: "Default true." },
      },
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  parse: parse_save,
  run: (ctx, args) => (args.id === null ? create(ctx, args) : change(ctx, args.id, args)),
});
