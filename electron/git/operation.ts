import fs from "node:fs/promises";
import path from "node:path";
import type { GitOperation } from "../../shared/git-view.ts";
import { error_code, missing_path } from "../storage/coerce.ts";
import { entry_kind } from "./repo.ts";

const read_text = async (file: string): Promise<string | null> => {
  try {
    return (await fs.readFile(file, "utf8")).trim();
  } catch (error) {
    if (!missing_path(error)) console.warn(`[git] reading ${file} for a running operation failed: ${error_code(error) || String(error)}`);
    return null;
  }
};

const read_number = async (file: string): Promise<number | null> => {
  const value = Number.parseInt((await read_text(file)) ?? "", 10);
  return Number.isFinite(value) ? value : null;
};

const read_branch = async (file: string): Promise<string | null> => (await read_text(file))?.replace(/^refs\/heads\//, "") || null;

const operation = (kind: GitOperation["kind"], step: number | null = null, total: number | null = null, branch: string | null = null): GitOperation => ({ kind, step, total, branch });

export const read_operation = async (git_dir: string): Promise<GitOperation | null> => {
  const at = (relative: string) => path.join(git_dir, relative);
  if ((await entry_kind(at("rebase-merge"))) === "dir") {
    return operation("rebase", await read_number(at("rebase-merge/msgnum")), await read_number(at("rebase-merge/end")), await read_branch(at("rebase-merge/head-name")));
  }
  if ((await entry_kind(at("rebase-apply"))) === "dir") {
    const step = await read_number(at("rebase-apply/next"));
    const total = await read_number(at("rebase-apply/last"));
    if (await entry_kind(at("rebase-apply/rebasing"))) return operation("rebase", step, total, await read_branch(at("rebase-apply/head-name")));
    if (await entry_kind(at("rebase-apply/applying"))) return operation("am", step, total);
    return operation("am_or_rebase", step, total);
  }
  if (await entry_kind(at("MERGE_HEAD"))) return operation("merge");
  if (await entry_kind(at("CHERRY_PICK_HEAD"))) return operation("cherry_pick");
  if (await entry_kind(at("REVERT_HEAD"))) return operation("revert");
  const todo = (await read_text(at("sequencer/todo")))?.split(/\r?\n/)[0] ?? "";
  if (/^(?:p|pick)\s/.test(todo)) return operation("cherry_pick");
  if (/^revert\s/.test(todo)) return operation("revert");
  if (await entry_kind(at("BISECT_LOG"))) return operation("bisect");
  return null;
};
