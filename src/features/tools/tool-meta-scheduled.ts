import type { ToolStep } from "../../../shared/chat.ts";
import type { ScheduledAction } from "../../../shared/scheduled.ts";
import type { MessageKey } from "../../i18n/translate.ts";
import { entry, fixed } from "./tool-meta-entry.ts";
import type { Label, ToolMeta } from "./tool-meta-types.ts";

type Phase = "active" | "done" | "attempt";

const change_action = (step: ToolStep): ScheduledAction => {
  if (step.view?.kind === "scheduled_tasks" && step.view.action !== "list") {
    return step.view.action;
  }
  if (step.approval?.kind === "scheduled_task") {
    return step.approval.action;
  }
  if (step.name === "delete_scheduled_task") {
    return "delete";
  }
  return typeof step.args.id === "string" ? "change" : "create";
};

const task_name = (step: ToolStep): string => {
  if (step.view?.kind === "scheduled_tasks") {
    return step.view.tasks[0]?.name ?? "";
  }
  if (step.approval?.kind === "scheduled_task") {
    return step.approval.task.name;
  }
  return typeof step.args.name === "string" ? step.args.name : "";
};

const change_label = (phase: Phase): Label => (t, step) => t(`scheduled.label_${change_action(step)}_${phase}`, { x: task_name(step) });

const change_meta = entry("schedule", "scheduled", change_label("active"), change_label("done"), change_label("attempt"));

export const scheduled_metas: Record<string, ToolMeta> = {
  list_scheduled_tasks: entry("schedule", "other", fixed("scheduled.label_list_active"), fixed("scheduled.label_list_done")),
  save_scheduled_task: change_meta,
  delete_scheduled_task: change_meta,
};

export const scheduled_target_key = (name: string): MessageKey | null => {
  if (name === "list_scheduled_tasks") {
    return "scheduled.list_target";
  }
  return name === "save_scheduled_task" || name === "delete_scheduled_task" ? "scheduled.denied_target" : null;
};
