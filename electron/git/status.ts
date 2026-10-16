import fs from "node:fs/promises";
import path from "node:path";
import type { GitEntry } from "../../shared/git-view.ts";
import { parse_status, type StatusBranch } from "../../shared/git/status-parse.ts";
import { error_code, missing_path } from "../storage/coerce.ts";
import type { RepoPaths } from "./repo.ts";
import { exec_git, git_ok, type GitConfigPair, type GitTool } from "./run.ts";

export type ProjectStatus = { raw: Buffer; nested: string; branch: StatusBranch; entries: GitEntry[]; outside: boolean };

const status_args = ["status", "--porcelain=v2", "--branch", "--show-stash", "-z", "--untracked-files=normal", "--ignored=matching", "--", "."];

export const run_status = async (tool: GitTool, root: string, config: GitConfigPair[], signal?: AbortSignal): Promise<Buffer> =>
  git_ok(await exec_git(tool, { cwd: root, args: status_args, config, signal }), `git status in ${root}`);

const has_git_entry = async (dir: string): Promise<boolean> => {
  try {
    await fs.stat(path.join(dir, ".git"));
    return true;
  } catch (error) {
    if (!missing_path(error)) console.warn(`[git] checking ${dir} for its own repository failed: ${error_code(error) || String(error)}`);
    return false;
  }
};

const project_relative = (repo_path: string, prefix: string): string => {
  if (repo_path.toLowerCase().startsWith(prefix.toLowerCase())) {
    return repo_path.slice(prefix.length);
  }
  const depth = prefix.split("/").filter(Boolean).length;
  return `${"../".repeat(depth)}${repo_path}`;
};

export const parse_project_status = async (raw: Buffer, paths: RepoPaths): Promise<ProjectStatus> => {
  const parsed = parse_status(raw.toString("utf8"));
  const prefix = paths.prefix;
  const key = prefix.toLowerCase();
  const outside = key !== "" && parsed.entries.some((entry) => (entry.status === "untracked" || entry.status === "ignored") && entry.path.toLowerCase() === key);
  if (outside) {
    return { raw, nested: "", branch: parsed.branch, entries: [], outside };
  }
  const inside = parsed.entries.filter((entry) => entry.path.toLowerCase().startsWith(key) && entry.path.length > key.length);
  const entries = await Promise.all(
    inside.map(async (entry): Promise<GitEntry> => ({
      ...entry,
      path: entry.path.slice(prefix.length),
      orig_path: entry.orig_path === null ? null : project_relative(entry.orig_path, prefix),
      nested_repo: entry.status === "untracked" && entry.path.endsWith("/") && (await has_git_entry(path.join(paths.top, entry.path))),
    })),
  );
  const nested = entries
    .filter((entry) => entry.nested_repo)
    .map((entry) => entry.path)
    .join("\0");
  return { raw, nested, branch: parsed.branch, entries, outside };
};

export const same_status = (left: ProjectStatus | null, right: ProjectStatus): boolean => left !== null && left.raw.equals(right.raw) && left.nested === right.nested;
