import { interval_ms, type ScheduleInterval, type ScheduledTask } from "../../shared/scheduled.ts";

export const next_slot = (anchor_ms: number, interval: ScheduleInterval, now_ms: number): number => {
  const step = interval_ms[interval];
  const slots = Math.floor((now_ms - anchor_ms) / step) + 1;
  return anchor_ms + Math.max(1, slots) * step;
};

export const due = (task: ScheduledTask, now_ms: number): boolean => task.enabled && Date.parse(task.next_run_at) <= now_ms;

export const clock_back = (task: ScheduledTask, now_ms: number): boolean => Date.parse(task.next_run_at) > now_ms + interval_ms[task.interval];
