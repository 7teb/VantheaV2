import fs from "node:fs/promises";
import path from "node:path";
import type { GitRepoInfo } from "../../shared/git-view.ts";
import { error_code, missing_path } from "../storage/coerce.ts";
import { path_key } from "../storage/paths.ts";
import { error_line, exec_git, type GitTool } from "./run.ts";

export type GitLocation = { work_tree: string; git_dir: string; common_dir: string; dot_git: "dir" | "file" };

export type RepoPaths = { top: string; git_dir: string; common_dir: string; prefix: string; superproject: string | null; shallow: boolean };

export type RepoDetect =
  | { kind: "repo"; paths: RepoPaths }
  | { kind: "none" }
  | { kind: "ownership"; path: string }
  | { kind: "error"; message: string; broken_gitfile: boolean };

export const fsmonitor_off = ["-c", "core.fsmonitor=false"];

const detect_args = [
  "rev-parse",
  "--is-bare-repository",
  "--is-shallow-repository",
  "--path-format=absolute",
  "--show-toplevel",
  "--git-dir",
  "--git-common-dir",
  "--show-prefix",
  "--show-superproject-working-tree",
];

export const read_optional = async (file: string): Promise<string | null> => {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (!missing_path(error)) console.warn(`[git] reading ${file} failed: ${error_code(error) || String(error)}`);
    return null;
  }
};

const stat_optional = async (file: string) => {
  try {
    return await fs.stat(file);
  } catch (error) {
    if (!missing_path(error)) console.warn(`[git] checking ${file} failed: ${error_code(error) || String(error)}`);
    return null;
  }
};

export const entry_kind = async (file: string): Promise<"file" | "dir" | null> => {
  const info = await stat_optional(file);
  if (!info) return null;
  return info.isDirectory() ? "dir" : "file";
};

export const gitfile_target = async (dot_git: string): Promise<string | null> => {
  const pointer = /^gitdir:\s*(.+)$/m.exec((await read_optional(dot_git)) ?? "")?.[1]?.trim();
  return pointer ? path.resolve(path.dirname(dot_git), pointer) : null;
};

export const git_location = async (root: string): Promise<GitLocation | null> => {
  if (!root.trim()) {
    return null;
  }
  let dir = path.resolve(root);
  for (;;) {
    const dot_git = path.join(dir, ".git");
    const info = await stat_optional(dot_git);
    if (info?.isDirectory()) {
      const common = (await read_optional(path.join(dot_git, "commondir")))?.trim();
      return { work_tree: dir, git_dir: dot_git, common_dir: common ? path.resolve(dot_git, common) : dot_git, dot_git: "dir" };
    }
    const git_dir = info?.isFile() ? await gitfile_target(dot_git) : null;
    if (git_dir) {
      const common = (await read_optional(path.join(git_dir, "commondir")))?.trim();
      return { work_tree: dir, git_dir, common_dir: common ? path.resolve(git_dir, common) : git_dir, dot_git: "file" };
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
};

export const classify_detect_failure = async (stderr: string, root: string): Promise<RepoDetect> => {
  if (/not a git repository \(or any of the parent directories\)/i.test(stderr)) {
    return { kind: "none" };
  }
  const owner = /detected dubious ownership in repository at '([^']+)'/i.exec(stderr);
  if (owner) {
    return { kind: "ownership", path: owner[1] ?? "" };
  }
  if (/must be run in a work tree|cannot use bare repository/i.test(stderr)) {
    return { kind: "none" };
  }
  const message = error_line(stderr);
  if (/not a git repository/i.test(stderr)) {
    return { kind: "error", message, broken_gitfile: (await git_location(root))?.dot_git === "file" };
  }
  return { kind: "error", message, broken_gitfile: false };
};

export const detect_repo = async (tool: GitTool, root: string, signal?: AbortSignal): Promise<RepoDetect> => {
  const output = await exec_git(tool, { cwd: root, args: detect_args, flags: fsmonitor_off, signal });
  if (output.code !== 0) {
    return classify_detect_failure(output.stderr, root);
  }
  const lines = output.stdout.toString("utf8").split("\n").map((line) => line.replace(/\r$/, ""));
  if (lines.length < 7) {
    throw new Error(`git rev-parse in ${root} printed ${lines.length} lines instead of at least 7`);
  }
  const [bare, shallow, top, git_dir, common_dir, prefix, superproject] = lines;
  if (bare === "true") {
    return { kind: "none" };
  }
  return {
    kind: "repo",
    paths: { top: top ?? "", git_dir: git_dir ?? "", common_dir: common_dir ?? "", prefix: prefix ?? "", superproject: superproject || null, shallow: shallow === "true" },
  };
};

export const same_paths = (left: RepoPaths, right: RepoPaths): boolean =>
  path_key(left.top) === path_key(right.top) &&
  path_key(left.git_dir) === path_key(right.git_dir) &&
  path_key(left.common_dir) === path_key(right.common_dir) &&
  left.prefix === right.prefix &&
  left.superproject === right.superproject &&
  left.shallow === right.shallow;

export const own_worktree = (paths: RepoPaths): string | null => {
  const common = path_key(paths.common_dir);
  const own = path_key(paths.git_dir);
  const match = own.startsWith(`${common}/worktrees/`) ? /^[^/]+$/.exec(own.slice(common.length + "/worktrees/".length)) : null;
  return match ? (match[0] ?? null) : null;
};

export const main_tree_of = (common_dir: string): string => (path.basename(common_dir).toLowerCase() === ".git" ? path.dirname(common_dir) : common_dir);

const ancestors = (dir: string): string[] => {
  const found: string[] = [];
  for (let current = path.resolve(dir); ; current = path.dirname(current)) {
    found.push(current);
    if (path.dirname(current) === current) {
      return found;
    }
  }
};

export const main_twin = async (dir: string): Promise<string | null> => {
  const kinds = await Promise.all(ancestors(dir).map((entry) => entry_kind(path.join(entry, ".git"))));
  if (!kinds.includes("file")) {
    return null;
  }
  const location = await git_location(dir);
  if (!location || location.dot_git !== "file" || path_key(location.git_dir) === path_key(location.common_dir)) {
    return null;
  }
  return path.join(main_tree_of(location.common_dir), path.relative(location.work_tree, path.resolve(dir)));
};

export const repo_info = (paths: RepoPaths): GitRepoInfo => {
  const worktree = own_worktree(paths);
  return {
    root: paths.top,
    prefix: paths.prefix.replace(/\/+$/, ""),
    worktree_of: worktree === null ? null : main_tree_of(paths.common_dir),
    superproject: paths.superproject,
    shallow: paths.shallow,
  };
};
