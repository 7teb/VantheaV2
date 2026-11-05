import { randomUUID } from "node:crypto";
import type { ScheduledInput, ScheduledTask } from "../../shared/scheduled.ts";
import { chat_meta, create_chat, update_meta } from "../chats/store.ts";
import { drop_task, patch_task, put_task, scheduled_task } from "./store.ts";
import { next_slot } from "./timing.ts";

export type TaskPatch = Partial<ScheduledInput>;

const require_task = (id: string): ScheduledTask => {
  const task = scheduled_task(id);
  if (!task) {
    throw new Error(`scheduled task ${id} not found`);
  }
  return task;
};

export const create_task = async (input: ScheduledInput): Promise<ScheduledTask> => {
  const chat = await create_chat(input.project_path);
  await update_meta(chat.id, { title: input.name, choice: input.choice });
  const now = new Date().toISOString();
  const task: ScheduledTask = {
    id: randomUUID(),
    chat_id: chat.id,
    prompt: input.prompt,
    interval: input.interval,
    enabled: input.enabled,
    choice: input.choice,
    mode: input.mode,
    created_at: now,
    updated_at: now,
    next_run_at: now,
    last_run: null,
    runs: [],
  };
  put_task(task);
  return task;
};

const next_run_at = (task: ScheduledTask, patch: TaskPatch, now: number): string => {
  const interval = patch.interval ?? task.interval;
  const switched_on = patch.enabled === true && !task.enabled;
  if (interval === task.interval && !switched_on) {
    return task.next_run_at;
  }
  return new Date(next_slot(Date.parse(task.last_run?.started_at ?? task.created_at), interval, now)).toISOString();
};

export const change_task = async (id: string, patch: TaskPatch): Promise<ScheduledTask> => {
  const task = require_task(id);
  const meta = chat_meta(task.chat_id);
  const title = patch.name !== undefined && patch.name !== meta?.title ? patch.name : undefined;
  const project_path = patch.project_path !== undefined && patch.project_path !== meta?.project_path ? patch.project_path : undefined;
  if (title !== undefined || project_path !== undefined) {
    await update_meta(task.chat_id, { title, project_path });
  }
  const now = Date.now();
  const next = patch_task(id, (current) => ({
    ...current,
    prompt: patch.prompt ?? current.prompt,
    interval: patch.interval ?? current.interval,
    enabled: patch.enabled ?? current.enabled,
    choice: patch.choice ?? current.choice,
    mode: patch.mode ?? current.mode,
    updated_at: new Date(now).toISOString(),
    next_run_at: next_run_at(current, patch, now),
  }));
  if (!next) {
    throw new Error(`scheduled task ${id} was deleted while it was being changed`);
  }
  return next;
};

export const set_task_enabled = (id: string, enabled: boolean): Promise<ScheduledTask> => change_task(id, { enabled });

export const delete_task = (id: string): void => {
  require_task(id);
  drop_task(id);
};
