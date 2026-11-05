import { kept_run_marks, type RunResult, type ScheduledTaskView } from "../../../shared/scheduled.ts";

export type TrailResult = RunResult | "running";

export type TrailMark = { started_at: string; result: TrailResult };

export type StatusKind = "running" | "waiting" | "new" | "quiet" | "failed" | "stopped" | "never";

export type CardState = "running" | "waiting" | "failed" | "idle";

export type DialState = "idle" | "running" | "waiting" | "off";

export const trail_marks = (task: ScheduledTaskView): TrailMark[] => {
  const live: TrailMark[] = task.running && task.last_run ? [{ started_at: task.last_run.started_at, result: "running" }] : [];
  return [...task.runs, ...live].slice(-kept_run_marks);
};

export const status_kind = (task: ScheduledTaskView, waiting: boolean): StatusKind => {
  if (task.running) {
    return waiting ? "waiting" : "running";
  }
  return task.last_run?.result ?? "never";
};

export const card_state = (task: ScheduledTaskView, waiting: boolean): CardState => {
  if (task.running) {
    return waiting ? "waiting" : "running";
  }
  return task.last_run?.result === "failed" ? "failed" : "idle";
};

export const dial_state = (task: ScheduledTaskView, waiting: boolean): DialState => {
  if (task.running) {
    return waiting ? "waiting" : "running";
  }
  return task.enabled ? "idle" : "off";
};

export const page_order = (left: ScheduledTaskView, right: ScheduledTaskView): number =>
  Number(right.enabled) - Number(left.enabled) || left.created_at.localeCompare(right.created_at);
