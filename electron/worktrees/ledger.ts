import path from "node:path";
import { as_array, as_iso, as_record } from "../storage/coerce.ts";
import { keep_corrupt, read_json, write_json } from "../storage/json-file.ts";
import { path_key, storage_paths } from "../storage/paths.ts";

export type LedgerBranch = { name: string; base: string; repo_dir: string };

export type LedgerEntry = { path: string; project_path: string; state: "creating" | "removing" | "agent"; at: string; branch?: LedgerBranch };

const ledger_states: readonly LedgerEntry["state"][] = ["creating", "removing", "agent"];

let chain: Promise<unknown> = Promise.resolve();

const serialize = <T>(work: () => Promise<T>): Promise<T> => {
  const run = chain.then(work);
  chain = Promise.allSettled([run]);
  return run;
};

const parse_branch = (value: unknown): LedgerBranch | null => {
  const raw = as_record(value);
  if (typeof raw.name !== "string" || !raw.name || typeof raw.base !== "string" || !raw.base || typeof raw.repo_dir !== "string" || !path.isAbsolute(raw.repo_dir)) {
    return null;
  }
  return { name: raw.name, base: raw.base, repo_dir: raw.repo_dir };
};

const parse_entry = (value: unknown, now: string): LedgerEntry[] => {
  const raw = as_record(value);
  const state = ledger_states.find((entry) => entry === raw.state) ?? null;
  if (typeof raw.path !== "string" || !path.isAbsolute(raw.path) || typeof raw.project_path !== "string" || state === null) {
    return [];
  }
  const branch = parse_branch(raw.branch);
  if (state === "agent" && !branch) {
    return [];
  }
  return [{ path: raw.path, project_path: raw.project_path, state, at: as_iso(raw.at, now), ...(branch ? { branch } : {}) }];
};

const write_entries = (entries: LedgerEntry[]) => write_json(storage_paths().worktree_ledger, { version: 1, entries });

const read_entries = async (): Promise<LedgerEntry[]> => {
  const file = storage_paths().worktree_ledger;
  const read = await read_json(file);
  if (read.status === "missing") {
    return [];
  }
  if (read.status === "corrupt") {
    const kept = await keep_corrupt(file);
    console.error(`[worktrees] the worktree ledger ${file} is corrupt (${read.error}), it was kept as ${kept} and starts empty`);
    await write_entries([]);
    return [];
  }
  const now = new Date().toISOString();
  return as_array(as_record(read.value).entries).flatMap((entry) => parse_entry(entry, now));
};

export const ledger_entries = (): Promise<LedgerEntry[]> => serialize(read_entries);

export const ledger_add = (entry: LedgerEntry): Promise<void> =>
  serialize(async () => {
    const entries = (await read_entries()).filter((existing) => path_key(existing.path) !== path_key(entry.path));
    await write_entries([...entries, entry]);
  });

export const ledger_drop = (dir: string): Promise<void> =>
  serialize(async () => {
    const entries = await read_entries();
    const kept = entries.filter((entry) => path_key(entry.path) !== path_key(dir));
    if (kept.length !== entries.length) {
      await write_entries(kept);
    }
  });
