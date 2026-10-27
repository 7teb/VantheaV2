import fs from "node:fs/promises";
import path from "node:path";
import { missing_object } from "../git/diff.ts";
import { sparse_add_git, version_at_least } from "../git/locate.ts";
import { entry_kind, fsmonitor_off } from "../git/repo.ts";
import { exec_git, git_failure_line, git_ok, type GitCall, type GitOutput } from "../git/run.ts";
import { error_code, missing_path } from "../storage/coerce.ts";
import { path_key } from "../storage/paths.ts";
import type { GitTarget } from "./git-target.ts";
import type { ChatPaths } from "./paths.ts";
import { tree_pattern, type TreePoint } from "./records.ts";

export type Snapshot = { point: TreePoint; index_repo: string };

type GitIn = (args: string[], input?: Buffer) => Promise<GitOutput>;

type Indexed = { tree: string; unreadable: string[] };

const alternate_entry = (dir: string): string => (/[;"]/.test(dir) ? `"${dir.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : dir);

export const snapshot_env = (paths: ChatPaths, common_dir: string, with_index: boolean): Record<string, string> => ({
  ...(with_index ? { GIT_INDEX_FILE: paths.index } : {}),
  GIT_OBJECT_DIRECTORY: paths.objects,
  GIT_ALTERNATE_OBJECT_DIRECTORIES: alternate_entry(path.join(common_dir, "objects")),
});

const unreadable_patterns = [/^error: open\("(.+)"\): /, /^error: unable to index file '(.+)'$/];

export const parse_unreadable = (stderr: string, prefix: string): string[] => {
  const found = new Set<string>();
  for (const line of stderr.split(/\r?\n/)) {
    for (const pattern of unreadable_patterns) {
      const file = pattern.exec(line.trim())?.[1];
      if (file === undefined) continue;
      const relative = file.replace(/\\/g, "/");
      found.add(prefix !== "" && relative.startsWith(prefix) ? relative.slice(prefix.length) : relative);
    }
  }
  return [...found].sort();
};

const unset_filter_values = new Set(["unspecified", "unset", "set"]);

export const parse_filtered = (output: string): string[] => {
  const fields = output.split("\0");
  const filtered: string[] = [];
  for (let at = 0; at + 2 < fields.length; at += 3) {
    const file = fields[at] ?? "";
    const value = fields[at + 2] ?? "";
    if (file !== "" && !unset_filter_values.has(value)) filtered.push(file);
  }
  return filtered;
};

export const parse_gitlinks = (output: string): string[] =>
  output
    .split("\0")
    .filter((record) => record.startsWith("160000 "))
    .map((record) => record.slice(record.indexOf("\t") + 1));

const object_gone = (stderr: string): boolean => missing_object(stderr) || /invalid object [0-7]+ [0-9a-f]{7,}/i.test(stderr);

const index_repo_key = async (common_dir: string): Promise<string> => path_key(await fs.realpath(common_dir));

const copy_index = async (from: string, to: string): Promise<void> => {
  try {
    await fs.copyFile(from, to);
  } catch (error) {
    if (!missing_path(error)) throw new Error(`copying the git index ${from} to ${to} failed: ${error_code(error) || String(error)}`, { cause: error });
    await fs.rm(to, { force: true });
  }
};

const git_in = (target: GitTarget, paths: ChatPaths, cwd: string, signal: AbortSignal): GitIn => (args, input) => {
  const call: GitCall = { cwd, args, flags: fsmonitor_off, config: target.config, literal_paths: true, env: snapshot_env(paths, target.paths.common_dir, true), input, signal };
  return exec_git(target.tool, call);
};

const remove_entries = async (git: GitIn, files: string[], what: string): Promise<void> => {
  if (files.length === 0) return;
  git_ok(await git(["update-index", "--force-remove", "-z", "--stdin"], Buffer.from(`${files.join("\0")}\0`, "utf8")), what);
};

const drop_filtered = async (git: GitIn, paths: ChatPaths, root: string): Promise<void> => {
  const tracked = git_ok(await git(["ls-files", "-z"]), `git ls-files of the snapshot index ${paths.index} in ${root}`);
  if (tracked.length === 0) return;
  const attributes = git_ok(await git(["check-attr", "-z", "--stdin", "filter"], tracked), `git check-attr filter in ${root}`).toString("utf8");
  const filtered = parse_filtered(attributes);
  await remove_entries(git, filtered, `removing ${filtered.length} files with a filter attribute from the snapshot index ${paths.index}`);
};

const seed_index = async (target: GitTarget, paths: ChatPaths, root: string, signal: AbortSignal): Promise<void> => {
  const git = git_in(target, paths, target.paths.top, signal);
  await copy_index(path.join(target.paths.git_dir, "index"), paths.index);
  const unmerged = await git(["ls-files", "-u", "-z"]);
  if (unmerged.code !== 0 || unmerged.stdout.length > 0) {
    await fs.rm(paths.index, { force: true });
    const head = await git(["rev-parse", "-q", "--verify", "HEAD"]);
    const tree = head.code === 0 ? ["read-tree", "HEAD"] : ["read-tree", "--empty"];
    git_ok(await git(tree), `git ${tree.join(" ")} into the snapshot index ${paths.index}`);
  }
  await drop_filtered(git_in(target, paths, root, signal), paths, root);
};

const drop_checked_out_gitlinks = async (git: GitIn, paths: ChatPaths, root: string): Promise<void> => {
  const staged = git_ok(await git(["ls-files", "-s", "-z"]), `git ls-files -s of the snapshot index ${paths.index} in ${root}`).toString("utf8");
  const checked_out: string[] = [];
  for (const file of parse_gitlinks(staged)) {
    if ((await entry_kind(path.join(root, file, ".git"))) !== null) checked_out.push(file);
  }
  await remove_entries(git, checked_out, `removing ${checked_out.length} nested repositories from the snapshot index ${paths.index}`);
};

const index_tree = async (target: GitTarget, paths: ChatPaths, root: string, signal: AbortSignal): Promise<Indexed> => {
  const git = git_in(target, paths, root, signal);
  await drop_checked_out_gitlinks(git, paths, root);
  const sparse = version_at_least(target.tool.numbers, sparse_add_git) ? ["--sparse"] : [];
  const added = await git(["add", "-A", "--ignore-errors", ...sparse, "--", "."]);
  const unreadable = added.code === 1 && !object_gone(added.stderr) ? parse_unreadable(added.stderr, target.paths.prefix) : [];
  if (added.code !== 0 && unreadable.length === 0) git_ok(added, `git add -A in ${root}`);
  const tree = git_ok(await git(["write-tree"]), `git write-tree in ${root}`).toString("utf8").trim();
  if (!tree_pattern.test(tree)) throw new Error(`git write-tree in ${root} printed ${JSON.stringify(tree.slice(0, 100))} instead of a tree id`);
  return { tree, unreadable };
};

export const take_git_snapshot = async (target: GitTarget, paths: ChatPaths, root: string, index_repo: string | null, signal: AbortSignal): Promise<Snapshot> => {
  await fs.mkdir(paths.objects, { recursive: true });
  await fs.rm(paths.index_lock, { force: true });
  const repo_key = await index_repo_key(target.paths.common_dir);
  if (repo_key !== index_repo || (await entry_kind(paths.index)) === null) await seed_index(target, paths, root, signal);
  const at = new Date().toISOString();
  try {
    return { point: { ...(await index_tree(target, paths, root, signal)), at }, index_repo: repo_key };
  } catch (error) {
    const line = git_failure_line(error);
    if (signal.aborted || line === null || !object_gone(line)) throw error;
    console.warn(`[turn-diff] the snapshot index ${paths.index} names an object that is gone from ${target.paths.common_dir} (${line}), seeding it again`);
    await fs.rm(paths.index, { force: true });
    await seed_index(target, paths, root, signal);
    return { point: { ...(await index_tree(target, paths, root, signal)), at }, index_repo: repo_key };
  }
};
