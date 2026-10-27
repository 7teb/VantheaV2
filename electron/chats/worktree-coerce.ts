import path from "node:path";
import type { ChatWorktree } from "../../shared/chat.ts";
import { is_record } from "../storage/coerce.ts";
import { is_branch_name } from "../worktrees/naming.ts";

const commit_id = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const valid_prefix = (prefix: string): boolean => prefix === "" || prefix.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !/[\\:]/.test(part));

export const parse_worktree = (value: unknown): ChatWorktree | undefined => {
  if (!is_record(value)) {
    return undefined;
  }
  const { path: dir, prefix, branch, base, created_at } = value;
  if (typeof dir !== "string" || !path.isAbsolute(dir) || typeof prefix !== "string" || !valid_prefix(prefix)) {
    return undefined;
  }
  if (typeof branch !== "string" || !is_branch_name(branch) || typeof base !== "string" || !commit_id.test(base)) {
    return undefined;
  }
  if (typeof created_at !== "string" || Number.isNaN(Date.parse(created_at))) {
    return undefined;
  }
  return { path: dir, prefix, branch, base, created_at };
};
