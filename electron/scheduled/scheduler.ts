import { interval_ms, type ScheduledTask } from "../../shared/scheduled.ts";
import { error_text } from "../storage/coerce.ts";
import { clock_back, due, next_slot } from "./timing.ts";

export type SchedulerDeps = {
  tasks: () => ScheduledTask[];
  busy: (task: ScheduledTask) => boolean;
  advance: (task_id: string, next_run_at: string) => void;
  run: (task: ScheduledTask) => void;
};

const wake_ceiling_ms = 60_000;

let deps: SchedulerDeps | null = null;

let timer: ReturnType<typeof setTimeout> | null = null;

const iso = (ms: number) => new Date(ms).toISOString();

const clear_timer = () => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
};

const arm = () => {
  clear_timer();
  if (!deps) {
    return;
  }
  const times = deps
    .tasks()
    .filter((task) => task.enabled)
    .map((task) => Date.parse(task.next_run_at));
  if (!times.length) {
    return;
  }
  const delay = Math.max(0, Math.min(Math.min(...times) - Date.now(), wake_ceiling_ms));
  timer = setTimeout(tick, delay);
};

const start_due = (current: SchedulerDeps, task: ScheduledTask, now: number) => {
  current.advance(task.id, iso(next_slot(Date.parse(task.next_run_at), task.interval, now)));
  if (current.busy(task)) {
    console.info(`[scheduled] skipped the due run of task ${task.id}, its chat is busy`);
    return;
  }
  current.run(task);
};

const tick = () => {
  timer = null;
  const current = deps;
  if (!current) {
    return;
  }
  const now = Date.now();
  for (const task of current.tasks()) {
    if (!task.enabled) {
      continue;
    }
    try {
      if (clock_back(task, now)) {
        current.advance(task.id, iso(now + interval_ms[task.interval]));
        continue;
      }
      if (due(task, now)) {
        start_due(current, task, now);
      }
    } catch (error) {
      console.error(`[scheduled] starting the due run of task ${task.id} failed: ${error_text(error)}`);
    }
  }
  arm();
};

export const start_scheduler = (next: SchedulerDeps): void => {
  deps = next;
  tick();
};

export const poke_scheduler = (): void => {
  arm();
};

export const stop_scheduler = (): void => {
  deps = null;
  clear_timer();
};
