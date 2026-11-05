import type { ApprovalDecision, ApprovalRequest } from "../../../shared/approval.ts";
import type { ScheduledAction, ScheduledCard, ScheduledInput, ScheduledTask, ScheduledTaskView } from "../../../shared/scheduled.ts";
import { tool_gate } from "../../permissions/tool-gate.ts";
import { note_reason, unanswered_text } from "../../permissions/verdict-text.ts";
import { cadence_text, local_minute } from "../../scheduled/note.ts";
import { view_of } from "../../scheduled/store.ts";
import type { ToolContext, ToolResult } from "../types.ts";

export const approval_rule =
  "Like any other change, a scheduled task change follows the permission mode: in ask mode it waits for the user's approval on a card, in auto and full mode the automatic review decides and may still ask the user, so never assume a change took effect until the tool result says so.";

export const card_of = (input: ScheduledInput): ScheduledCard => ({
  name: input.name,
  prompt: input.prompt,
  interval: input.interval,
  enabled: input.enabled,
  mode: input.mode,
  model: input.choice.model,
  effort: input.choice.effort,
  project_path: input.project_path,
});

const model_text = (task: ScheduledTask): string => {
  const extras = [task.choice.effort, ...(task.choice.pro ? ["Pro"] : []), ...(task.choice.tier ? [task.choice.tier] : [])].filter(Boolean);
  return extras.length ? `${task.choice.model} (${extras.join(", ")})` : task.choice.model;
};

const last_run_text = (task: ScheduledTask): string => {
  const run = task.last_run;
  if (!run) {
    return "not run yet";
  }
  return run.result === null ? `running since ${local_minute(new Date(run.started_at))}` : `${run.result} at ${local_minute(new Date(run.ended_at ?? run.started_at))}`;
};

export const task_line = (task: ScheduledTaskView): string =>
  [
    `${task.id} "${task.name}" ${cadence_text[task.interval]}`,
    task.enabled ? "on" : "off",
    model_text(task),
    `${task.mode} mode`,
    task.project_path ? `project ${task.project_path}` : "no project",
    task.enabled ? `next run ${local_minute(new Date(task.next_run_at))}` : "paused",
    `last run ${last_run_text(task)}`,
  ].join(", ");

export const scheduled_result = (status: ToolResult["status"], action: ScheduledAction | "list", text: string, tasks: ScheduledTaskView[], previous: ScheduledCard | null = null): ToolResult => ({
  status,
  text,
  view: { kind: "scheduled_tasks", action, tasks, previous },
});

export const views_of = (tasks: ScheduledTask[]): ScheduledTaskView[] => tasks.flatMap((task) => view_of(task) ?? []);

export const failed = (text: string): ToolResult => ({ status: "failed", text, view: null });

export const unknown_task = (id: string): ToolResult => failed(`No scheduled task has the id ${id.slice(0, 80)}. Call list_scheduled_tasks to see the ids. Nothing was changed.`);

type ScheduledRequest = Extract<ApprovalRequest, { kind: "scheduled_task" }>;

const review_subject = ({ action, task, previous }: ScheduledRequest): string =>
  [
    "A scheduled task is a prompt VantheaX runs on its own, unattended, again and again on a schedule while the app is open. Every run is a full turn in the task's own chat with all tools of its permission mode, and runs with news notify the user.",
    `action: ${action}`,
    `name: ${task.name}`,
    `schedule: ${cadence_text[task.interval]}`,
    `permission mode of every run: ${task.mode}`,
    `model: ${task.model}${task.effort ? ` (effort ${task.effort})` : ""}`,
    `project: ${task.project_path || "no project"}`,
    `enabled: ${task.enabled ? "yes" : "no"}`,
    `prompt:\n${task.prompt}`,
    ...(previous && previous.prompt !== task.prompt ? [`previous prompt:\n${previous.prompt}`] : []),
    ...(previous && previous.interval !== task.interval ? [`previous schedule: ${cadence_text[previous.interval]}`] : []),
  ].join("\n");

const declined = (decision: ApprovalDecision): ToolResult => ({
  status: "denied",
  text: `The user declined this scheduled task change. Nothing was changed. User feedback: ${decision.feedback.trim() || "none."} Do not set up scheduled tasks another way and do not propose the same change again unless the user asks for it.`,
  view: null,
});

export const approve_change = async (ctx: ToolContext, request: ScheduledRequest): Promise<ToolResult | null> => {
  const gate = await tool_gate(ctx, request.action === "delete" ? "delete_scheduled_task" : "save_scheduled_task", review_subject(request));
  if (gate.kind === "run") {
    return null;
  }
  if (gate.kind === "denied") {
    return { status: "denied", text: gate.text, view: null };
  }
  const decision = await ctx.approve({ ...request, ...(gate.note ? { review: gate.note } : {}) });
  if (decision.expired) {
    return { status: "denied", text: unanswered_text("tool call", note_reason(gate.note)), view: null };
  }
  return decision.approved ? null : declined(decision);
};
