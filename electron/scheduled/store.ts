import { is_running, type ScheduledTask, type ScheduledTaskView } from "../../shared/scheduled.ts";
import { chat_meta } from "../chats/store.ts";
import { error_text } from "../storage/coerce.ts";
import { keep_corrupt, read_json, write_json } from "../storage/json-file.ts";
import { parse_stored_file, stored_file } from "./records.ts";

const tasks = new Map<string, ScheduledTask>();

const listeners = new Set<() => void>();

let data_file: string | null = null;

const current_file = (): string => {
  if (!data_file) {
    throw new Error("scheduled tasks used before load_scheduled");
  }
  return data_file;
};

const save = (): Promise<void> => {
  const file = current_file();
  return write_json(file, stored_file(tasks.values())).catch((error: unknown) => {
    console.error(`[scheduled] saving ${file} failed: ${error_text(error)}`);
  });
};

const changed = () => {
  void save();
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error(`[scheduled] a change listener failed: ${error_text(error)}`);
    }
  }
};

export const load_scheduled = async (file: string): Promise<void> => {
  data_file = file;
  tasks.clear();
  const stored = await read_json(file);
  if (stored.status === "missing") {
    return;
  }
  if (stored.status === "corrupt") {
    console.error(`[scheduled] ${file} is not valid JSON (${stored.error}), keeping a copy at ${await keep_corrupt(file)} and starting without tasks`);
    return;
  }
  const parsed = parse_stored_file(stored.value, new Date().toISOString(), (chat_id) => chat_meta(chat_id) !== null);
  for (const task of parsed.tasks) {
    tasks.set(task.id, task);
  }
  if (parsed.changed) {
    await save();
  }
};

export const on_scheduled_changed = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const scheduled_tasks = (): ScheduledTask[] => [...tasks.values()];

export const scheduled_task = (id: string): ScheduledTask | null => tasks.get(id) ?? null;

export const task_of_chat = (chat_id: string): ScheduledTask | null => [...tasks.values()].find((task) => task.chat_id === chat_id) ?? null;

export const put_task = (task: ScheduledTask): void => {
  tasks.set(task.id, task);
  changed();
};

export const patch_task = (id: string, patch: (task: ScheduledTask) => ScheduledTask): ScheduledTask | null => {
  const task = tasks.get(id);
  if (!task) {
    return null;
  }
  const next = patch(task);
  put_task(next);
  return next;
};

export const drop_task = (id: string): boolean => {
  if (!tasks.delete(id)) {
    return false;
  }
  changed();
  return true;
};

export const forget_scheduled_chat = (chat_id: string): void => {
  const task = task_of_chat(chat_id);
  if (task) {
    drop_task(task.id);
  }
};

export const view_of = (task: ScheduledTask): ScheduledTaskView | null => {
  const meta = chat_meta(task.chat_id);
  return meta ? { ...task, name: meta.title, project_path: meta.project_path, running: is_running(task) } : null;
};

export const scheduled_views = (): ScheduledTaskView[] =>
  [...tasks.values()]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .flatMap((task) => view_of(task) ?? []);
