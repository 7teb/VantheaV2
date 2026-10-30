import fs from "node:fs/promises";
import path from "node:path";
import type { WorkflowSummary } from "../../shared/workflow.ts";
import { append_journal, close_journal, drop_journal, flush_journal, read_journal } from "../agents/journal.ts";
import { error_code, error_text } from "../storage/coerce.ts";
import { keep_corrupt, read_json, write_file_atomic, write_json, write_json_sync, writes_settled } from "../storage/json-file.ts";
import { path_key } from "../storage/paths.ts";
import type { SweptAgentTree } from "../worktrees/sweep.ts";
import { parse_journal, parse_state, run_id_pattern, stored_state, type JournalRecord, type StoredRun } from "./records.ts";

type Listener = (summary: WorkflowSummary) => void;

export const change_throttle_ms = 250;

const runs = new Map<string, StoredRun>();

const listeners = new Set<Listener>();

const pending = new Map<string, ReturnType<typeof setTimeout>>();

let root: string | null = null;

const workflows_root = (): string => {
  if (!root) {
    throw new Error("workflow store used before init_workflow_store");
  }
  return root;
};

export const runs_dir = () => path.join(workflows_root(), "runs");

export const user_saved_dir = () => path.join(workflows_root(), "saved");

export const user_roles_dir = () => path.join(workflows_root(), "roles");

export const run_dir = (run_id: string) => path.join(runs_dir(), run_id);

export const script_file = (run_id: string) => path.join(run_dir(run_id), "script.js");

export const journal_file = (run_id: string) => path.join(run_dir(run_id), "journal.jsonl");

export const result_file = (run_id: string) => path.join(run_dir(run_id), "result.json");

const state_file = (run_id: string) => path.join(run_dir(run_id), "state.json");

const notify = (summary: WorkflowSummary) => {
  for (const listener of listeners) {
    try {
      listener(summary);
    } catch (error) {
      console.error(`[workflows] change listener for run ${summary.run_id} failed: ${error_text(error)}`);
    }
  }
};

const save = (run: StoredRun) => {
  const file = state_file(run.summary.run_id);
  write_json(file, stored_state(run)).catch((error: unknown) => console.error(`[workflows] saving ${file} failed: ${error_text(error)}`));
};

export const on_workflow_changed = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const load_run = async (dir_name: string, now: string): Promise<StoredRun | null> => {
  const file = state_file(dir_name);
  const stored = await read_json(file);
  if (stored.status === "missing") {
    return null;
  }
  if (stored.status === "corrupt") {
    console.error(`[workflows] ${file} is not valid JSON (${stored.error}), keeping a copy at ${await keep_corrupt(file)}`);
    return null;
  }
  const parsed = parse_state(stored.value, now);
  if (!parsed || parsed.summary.run_id !== dir_name) {
    console.error(`[workflows] ${file} does not hold a workflow run state for ${dir_name}, it is ignored`);
    return null;
  }
  return parsed;
};

export const init_workflow_store = async (dir: string): Promise<StoredRun[]> => {
  root = dir;
  runs.clear();
  let names: string[];
  try {
    names = await fs.readdir(runs_dir());
  } catch (error) {
    if (error_code(error) === "ENOENT") {
      return [];
    }
    throw error;
  }
  const now = new Date().toISOString();
  const owed: StoredRun[] = [];
  for (const name of names.filter((entry) => run_id_pattern.test(entry))) {
    const loaded = await load_run(name, now);
    if (!loaded) {
      continue;
    }
    runs.set(name, loaded);
    if (loaded.notice_due) {
      owed.push(loaded);
      loaded.notice_due = false;
      save(loaded);
    }
  }
  return owed;
};

export const add_run = async (run: StoredRun, script: string): Promise<void> => {
  const id = run.summary.run_id;
  runs.set(id, run);
  notify(run.summary);
  await fs.mkdir(run_dir(id), { recursive: true });
  await write_file_atomic(script_file(id), script);
  save(run);
};

export const get_run = (run_id: string): StoredRun | null => runs.get(run_id) ?? null;

export const chat_runs = (chat_id: string): WorkflowSummary[] =>
  [...runs.values()].filter((run) => run.summary.chat_id === chat_id).map((run) => run.summary).sort((a, b) => b.started_at.localeCompare(a.started_at));

export const running_workflows_in_chat = (chat_id: string): number => [...runs.values()].filter((run) => run.summary.chat_id === chat_id && run.summary.status === "running").length;

export const update_run = (run_id: string, edit: (summary: WorkflowSummary) => void, immediate = false): WorkflowSummary | null => {
  const run = runs.get(run_id);
  if (!run) {
    return null;
  }
  edit(run.summary);
  if (immediate || run.summary.status !== "running") {
    const timer = pending.get(run_id);
    if (timer) {
      clearTimeout(timer);
      pending.delete(run_id);
    }
    save(run);
    notify(run.summary);
    return run.summary;
  }
  if (!pending.has(run_id)) {
    const timer = setTimeout(() => {
      pending.delete(run_id);
      const current = runs.get(run_id);
      if (current) {
        save(current);
        notify(current.summary);
      }
    }, change_throttle_ms);
    timer.unref();
    pending.set(run_id, timer);
  }
  return run.summary;
};

const in_tree = (dir: string, tree: string): boolean => {
  const key = path_key(dir);
  return key === tree || key.startsWith(`${tree}/`);
};

export const record_swept_worktrees = (trees: readonly SweptAgentTree[]): void => {
  for (const tree of trees) {
    const key = path_key(tree.path);
    for (const run of runs.values()) {
      const agent = run.summary.agents.find((entry) => entry.worktree && in_tree(entry.worktree.path, key));
      const worktree = agent?.worktree;
      if (!worktree || worktree.kept === tree.kept) {
        continue;
      }
      update_run(run.summary.run_id, () => {
        worktree.kept = tree.kept;
      });
    }
  }
};

export const append_call = (run_id: string, entry: Record<string, unknown>): void => append_journal(journal_file(run_id), entry);

export const flush_calls = (run_id: string): Promise<void> => flush_journal(journal_file(run_id));

export const close_calls = (run_id: string): Promise<void> => close_journal(journal_file(run_id));

export const read_calls = async (run_id: string): Promise<Map<number, JournalRecord>> => {
  await flush_journal(journal_file(run_id));
  return parse_journal(await read_journal(journal_file(run_id)));
};

export const read_script_file = (run_id: string): Promise<string> => fs.readFile(script_file(run_id), "utf8");

export const write_result = async (run_id: string, value_json: string): Promise<void> => {
  const file = result_file(run_id);
  try {
    await write_file_atomic(file, value_json);
  } catch (error) {
    console.error(`[workflows] saving the return value of ${run_id} to ${file} failed: ${error_text(error)}`);
  }
};

export const save_interrupted_sync = (run_id: string): void => {
  const run = runs.get(run_id);
  if (!run) {
    return;
  }
  run.notice_due = true;
  const timer = pending.get(run_id);
  if (timer) {
    clearTimeout(timer);
    pending.delete(run_id);
  }
  try {
    write_json_sync(state_file(run_id), stored_state(run));
  } catch (error) {
    console.error(`[workflows] saving ${state_file(run_id)} on quit failed: ${error_text(error)}`);
  }
};

export const remove_chat_runs = async (chat_id: string): Promise<void> => {
  const owned = [...runs.values()].filter((run) => run.summary.chat_id === chat_id).map((run) => run.summary.run_id);
  for (const run_id of owned) {
    runs.delete(run_id);
    const timer = pending.get(run_id);
    if (timer) {
      clearTimeout(timer);
      pending.delete(run_id);
    }
    drop_journal(journal_file(run_id));
  }
  await Promise.all(owned.map((run_id) => writes_settled(state_file(run_id))));
  await Promise.all(
    owned.map((run_id) =>
      fs.rm(run_dir(run_id), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch((error: unknown) => {
        console.error(`[workflows] deleting ${run_dir(run_id)} failed: ${error_text(error)}`);
      }),
    ),
  );
};
