import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { BackgroundTask } from "../../shared/ipc/work.ts";
import type { ShellKind } from "../../shared/shell.ts";
import { invalidate_index } from "../project/index.ts";
import { resolve_inside } from "../project/scope.ts";
import { output_collector, type OutputCollector, type OutputView } from "../shell/output.ts";
import { exit_grace_ms, kill_tree, kill_tree_sync, shell_exit, shell_spawners, signal_note } from "../shell/process.ts";
import type { ShellDetach } from "../shell/run.ts";
import { error_text } from "../storage/coerce.ts";
import { keep_corrupt, read_json, write_json, write_json_sync } from "../storage/json-file.ts";
import { storage_paths } from "../storage/paths.ts";
import { listing_order, parse_stored_file, public_task, stored_file, type TaskRecord } from "./records.ts";

export type BackgroundSpawner = (command: string, cwd: string, shell: ShellKind) => ChildProcess;

export type BackgroundOptions = {
  data_file: string;
  spawner: BackgroundSpawner;
  kill: (pid: number | null) => void;
  kill_sync: (pid: number | null) => void;
};

export type BackgroundStart = { chat_id: string; turn_id: string; project_root: string; cwd: string; name: string; command: string; shell: ShellKind };

export type AdoptOutcome = { status: "moved"; task: BackgroundTask } | { status: "finished" | "full" };

export type TaskLookup = { task: BackgroundTask; output: OutputView } | { task: null; error: string };

type Listener = (task: BackgroundTask, output: OutputView) => void;

export const max_running_tasks = 16;

const change_throttle_ms = 1000;

const tasks = new Map<string, TaskRecord>();

const pending_emits = new Map<string, ReturnType<typeof setTimeout>>();

const read_results = new Set<string>();

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
      listener(task, record.output);
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
  record.output.append(chunk);
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
  let grace: ReturnType<typeof setTimeout> | null = null;
  const finish_exit = (code: number | null, signal: NodeJS.Signals | null) => {
    const exit = shell_exit(record.shell, code, signal);
    finish(record, exit.exit_code, exit.signal ? signal_note(exit.signal) : "");
  };
  child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
    grace = setTimeout(() => finish_exit(code, signal), exit_grace_ms);
  });
  child.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
    if (grace) {
      clearTimeout(grace);
    }
    finish_exit(code, signal);
  });
};

export const init_background = async (overrides: Partial<BackgroundOptions> = {}) => {
  const data_file = overrides.data_file ?? storage_paths().background;
  options = {
    data_file,
    spawner: overrides.spawner ?? ((command, cwd, shell) => shell_spawners[shell](command, cwd)),
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

const has_room = () => running_count() < max_running_tasks;

type Launched = { id: string; child: ChildProcess; cwd: string; started_at: string; output: OutputCollector };

const track = (input: BackgroundStart, launched: Launched): BackgroundTask => {
  const record: TaskRecord = {
    id: launched.id,
    chat_id: input.chat_id,
    name: input.name,
    command: input.command,
    shell: input.shell,
    cwd: launched.cwd,
    status: "running",
    exit_code: null,
    started_at: launched.started_at,
    ended_at: null,
    project_root: input.project_root,
    turn_id: input.turn_id,
    pid: launched.child.pid ?? null,
    output: launched.output,
  };
  tasks.set(record.id, record);
  watch(record, launched.child);
  save();
  emit_now(record);
  return public_task(record);
};

const new_task_id = () => `bg_${randomUUID()}`;

export const start_background = async (input: BackgroundStart): Promise<BackgroundTask> => {
  const { spawner } = current_options();
  const scoped = await resolve_inside(input.project_root, input.cwd || ".");
  if (!has_room()) {
    throw new Error(`At most ${max_running_tasks} background tasks can run at once; wait for one to finish or cancel one.`);
  }
  const child = spawner(input.command, scoped.target, input.shell);
  return track(input, { id: new_task_id(), child, cwd: scoped.relative, started_at: new Date().toISOString(), output: output_collector() });
};

export const adopt_background = (input: BackgroundStart, detach: ShellDetach): AdoptOutcome => {
  if (!has_room()) {
    return { status: "full" };
  }
  const id = new_task_id();
  const taken = detach(id);
  if (!taken) {
    return { status: "finished" };
  }
  const started_at = new Date(taken.started_at).toISOString();
  return { status: "moved", task: track(input, { id, child: taken.child, cwd: input.cwd, started_at, output: taken.output }) };
};

export const running_background_roots = (): string[] =>
  [...tasks.values()].filter((record) => record.status === "running").flatMap((record) => [record.project_root, path.resolve(record.project_root, record.cwd)]);

export const list_background = (chat_id: string): BackgroundTask[] =>
  [...tasks.values()].filter((record) => record.chat_id === chat_id).sort(listing_order).map(public_task);

export const find_background = (id: string, chat_id: string): TaskLookup => {
  const owned = [...tasks.values()].filter((record) => record.chat_id === chat_id);
  const exact = owned.find((record) => record.id === id);
  const matches = exact ? [exact] : owned.filter((record) => id !== "" && record.id.startsWith(id));
  if (matches.length === 1) {
    return { task: public_task(matches[0]), output: matches[0].output };
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
      read_results.delete(id);
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
    read_results.delete(id);
  }
  save();
};

export const mark_result_read = (task_id: string): void => {
  read_results.add(task_id);
};

export const result_was_read = (task_id: string): boolean => read_results.has(task_id);

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
