import fs from "node:fs/promises";
import path from "node:path";
import { list_chats } from "../chats/store.ts";
import { error_code } from "../storage/coerce.ts";
import { path_key, storage_paths } from "../storage/paths.ts";
import { ledger_drop, ledger_entries, type LedgerEntry } from "./ledger.ts";
import { id_folder, remove_worktree_folder } from "./remove.ts";

const listed_dirs = async (dir: string): Promise<string[]> => {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => path.join(dir, entry.name));
  } catch (error) {
    if (error_code(error) === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const report_unknown = async (known: Set<string>) => {
  const unknown: string[] = [];
  for (const holder of await listed_dirs(storage_paths().worktrees)) {
    const leaves = await listed_dirs(holder);
    if (leaves.length === 0 || leaves.some((leaf) => !known.has(path_key(leaf)))) {
      unknown.push(holder);
    }
  }
  if (unknown.length > 0) {
    console.warn(`[worktrees] ${unknown.length} folders under ${storage_paths().worktrees} belong to no chat and no unfinished step, they are left alone: ${unknown.join(", ")}`);
  }
};

const settle_entry = async (entry: LedgerEntry, referenced: Set<string>) => {
  if (referenced.has(path_key(entry.path))) {
    await ledger_drop(entry.path);
    return;
  }
  try {
    id_folder(entry.path);
  } catch (error) {
    console.error(`[worktrees] the ledger names ${entry.path} outside the worktree folder, the entry is dropped:`, error);
    await ledger_drop(entry.path);
    return;
  }
  try {
    await remove_worktree_folder(entry.project_path, entry.path);
    await ledger_drop(entry.path);
    console.info(`[worktrees] finished the ${entry.state} step of ${entry.path} left over from the last run`);
  } catch (error) {
    console.error(`[worktrees] removing the ${entry.state} worktree ${entry.path} failed, it is retried at the next start:`, error);
  }
};

export const sweep_worktree_ledger = async (): Promise<void> => {
  const read = ledger_entries();
  const referenced = new Set(list_chats().flatMap((meta) => (meta.worktree ? [path_key(meta.worktree.path)] : [])));
  const entries = await read;
  for (const entry of entries) {
    await settle_entry(entry, referenced);
  }
  await report_unknown(new Set([...referenced, ...entries.map((entry) => path_key(entry.path))]));
};
