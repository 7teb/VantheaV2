import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { BackgroundTask } from "../../shared/ipc/work.ts";
import { invalidate_index } from "../project/index.ts";
import { resolve_inside } from "../project/scope.ts";
import { kill_tree, kill_tree_sync, spawn_powershell, strip_ansi } from "../shell/process.ts";
import { error_text } from "../storage/coerce.ts";
import { keep_corrupt, read_json, write_json, write_json_sync } from "../storage/json-file.ts";
import { storage_paths } from "../storage/paths.ts";
import { listing_order, parse_stored_file, public_task, stored_file, tail_chars, type TaskRecord } from "./records.ts";

export type BackgroundSpawner = (command: string, cwd: string) => ChildProcess;

export type BackgroundOptions = {
  data_file: string;
  spawner: BackgroundSpawner;
  kill: (pid: number | null) => void;
  kill_sync: (pid: number | null) => void;
};

export type BackgroundStart = { chat_id: string; turn_id: string; project_root: string; cwd: string; name: string; command: string };

export type TaskLookup = { task: BackgroundTask } | { task: null; error: string };

type Listener = (task: BackgroundTask) => void;

export const max_running_tasks = 16;

const change_throttle_ms = 1000;

const tasks = new Map<string, TaskRecord>();

const pending_emits = new Map<string, ReturnType<typeof setTimeout>>();

const changed_listeners = new Set<Listener>();

const finished_listeners = new Set<Listener>();

let options: BackgroundOptions | null = null;

const current_options = (): BackgroundOptions => {
  if (!options) {
    throw new Error("background tasks used before init_background");
  }
  return options;
};

const save = (): Promise<void> => {
  const file = current_options().data_file;
  return write_json(file, stored_file(tasks.values())).catch((error: unknown) => {
    console.error(`[background] saving ${file} failed: ${error_text(error)}`);
  });
};

const notify = (listeners: Set<Listener>, record: TaskRecord) => {
  const task = public_task(record);
  for (const listener of listeners) {
    try {
      listener(task);
    } catch (error) {
      console.error(`[background] listener for task ${record.id} failed: ${error_text(error)}`);
    }
  }
};

const emit_now = (record: TaskRecord) => {
  const pending = pending_emits.get(record.id);
  if (pending) {
    clearTimeout(pending);
    pending_emits.delete(record.id);
  }
  notify(changed_listeners, record);
};

const emit_later = (record: TaskRecord) => {
  if (pending_emits.has(record.id)) {
    return;
  }
  const timer = setTimeout(() => {
    pending_emits.delete(record.id);
    notify(changed_listeners, record);
  }, change_throttle_ms);
  timer.unref();
  pending_emits.set(record.id, timer);
};

const append_output = (record: TaskRecord, chunk: string) => {
  record.output_tail = (record.output_tail + strip_ansi(chunk)).slice(-tail_chars);
  emit_later(record);
};

const finish = (record: TaskRecord, exit_code: number | null, failure: string) => {
  if (record.status !== "running") {
    return;
  }
  if (failure) {
    append_output(record, `\n${failure}`);
  }
  record.status = exit_code === 0 && !failure ? "completed" : "failed";
  record.exit_code = exit_code;
  record.ended_at = new Date().toISOString();
  record.pid = null;
  invalidate_index(record.project_root);
  save();
  emit_now(record);
  notify(finished_listeners, record);
};

const watch = (record: TaskRecord, child: ChildProcess) => {
  const on_data = (chunk: string | Buffer) => append_output(record, String(chunk));
  child.stdout?.on("data", on_data);
  child.stderr?.on("data", on_data);
  child.once("error", (error: Error) => {
    console.warn(`[background] task ${record.id} (${record.command.slice(0, 200)}) failed: ${error.message}`);
    finish(record, null, `[failed to run: ${error.message}]`);
  });
  child.once("close", (code: number | null) => finish(record, code, ""));
};

export const init_background = async (overrides: Partial<BackgroundOptions> = {}) => {
  const data_file = overrides.data_file ?? storage_paths().background;
  options = {
    data_file,
    spawner: overrides.spawner ?? spawn_powershell,
    kill: overrides.kill ?? kill_tree,
    kill_sync: overrides.kill_sync ?? kill_tree_sync,
  };
  tasks.clear();
  const stored = await read_json(data_file);
  if (stored.status === "corrupt") {
    console.error(`[background] ${data_file} is not valid JSON (${stored.error}), keeping a copy at ${await keep_corrupt(data_file)}`);
    return;
  }
  if (stored.status === "missing") {
    return;
  }
  const parsed = parse_stored_file(stored.value, new Date().toISOString());
  for (const record of parsed.records) {
    tasks.set(record.id, record);
  }
  if (parsed.interrupted) {
    await save();
  }
};

const running_count = () => [...tasks.values()].filter((record) => record.status === "running").length;

export const start_background = async (input: BackgroundStart): Promise<BackgroundTask> => {
  const { spawner } = current_options();
  const scoped = await resolve_inside(input.project_root, input.cwd || ".");
  if (running_count() >= max_running_tasks) {
    throw new Error(`At most ${max_running_tasks} background tasks can run at once; wait for one to finish or cancel one.`);
  }
  const child = spawner(input.command, scoped.target);
  const record: TaskRecord = {
    id: `bg_${randomUUID()}`,
    chat_id: input.chat_id,
    name: input.name,
    command: input.command,
    cwd: scoped.relative,
    status: "running",
    exit_code: null,
    started_at: new Date().toISOString(),
    ended_at: null,
    output_tail: "",
    project_root: input.project_root,
    turn_id: input.turn_id,
    pid: child.pid ?? null,
  };
  tasks.set(record.id, record);
  watch(record, child);
  save();
  emit_now(record);
  return public_task(record);
};

export const list_background = (chat_id: string): BackgroundTask[] =>
  [...tasks.values()].filter((record) => record.chat_id === chat_id).sort(listing_order).map(public_task);

export const find_background = (id: string, chat_id: string): TaskLookup => {
  const owned = [...tasks.values()].filter((record) => record.chat_id === chat_id);
  const exact = owned.find((record) => record.id === id);
  const matches = exact ? [exact] : owned.filter((record) => id !== "" && record.id.startsWith(id));
  if (matches.length === 1) {
    return { task: public_task(matches[0]) };
  }
  if (matches.length > 1) {
    return { task: null, error: `${id} matches ${matches.length} background tasks (${matches.slice(0, 5).map((record) => record.id).join(", ")}); pass more of the id.` };
  }
  return { task: null, error: `No background task ${id} exists in this chat.` };
};

export const cancel_background = (task_id: string): BackgroundTask => {
  const record = tasks.get(task_id);
  if (!record) {
    throw new Error(`background task ${task_id} not found`);
  }
  if (record.status !== "running") {
    return public_task(record);
  }
  current_options().kill(record.pid);
  record.status = "cancelled";
  record.ended_at = new Date().toISOString();
  record.pid = null;
  invalidate_index(record.project_root);
  save();
  emit_now(record);
  return public_task(record);
};

export const clear_background = (chat_id: string) => {
  for (const [id, record] of tasks) {
    if (record.chat_id === chat_id && record.status !== "running") {
      tasks.delete(id);
    }
  }
  save();
};

export const remove_chat_background = (chat_id: string) => {
  for (const [id, record] of tasks) {
    if (record.chat_id !== chat_id) {
      continue;
    }
    if (record.status === "running") {
      cancel_background(id);
    }
    tasks.delete(id);
  }
  save();
};

export const on_background_changed = (listener: Listener): (() => void) => {
  changed_listeners.add(listener);
  return () => changed_listeners.delete(listener);
};

export const on_background_finished = (listener: Listener): (() => void) => {
  finished_listeners.add(listener);
  return () => finished_listeners.delete(listener);
};

export const shutdown_background_sync = () => {
  if (!options) {
    return;
  }
  const now = new Date().toISOString();
  for (const record of tasks.values()) {
    if (record.status !== "running") {
      continue;
    }
    options.kill_sync(record.pid);
    record.status = "interrupted";
    record.ended_at = now;
    record.pid = null;
  }
  for (const timer of pending_emits.values()) {
    clearTimeout(timer);
  }
  pending_emits.clear();
  try {
    write_json_sync(options.data_file, stored_file(tasks.values()));
  } catch (error) {
    console.error(`[background] saving ${options.data_file} on quit failed: ${error_text(error)}`);
  }
};
