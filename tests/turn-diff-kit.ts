import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { take_git_snapshot, snapshot_env, type Snapshot } from "../electron/turn-diff/git-snapshot.ts";
import { resolve_target, type GitTarget } from "../electron/turn-diff/git-target.ts";
import { chat_paths, type ChatPaths } from "../electron/turn-diff/paths.ts";
import { scratch, tool } from "./git-kit.ts";

export const signal = new AbortController().signal;

export const git_target = async (root: string): Promise<GitTarget> => {
  const target = await resolve_target(root, signal);
  if (target.kind !== "git") throw new Error(`${root} resolved to recorded mode: ${target.reason} ${target.detail}`);
  return target;
};

export const store_for = async (chat_id = "chat-a"): Promise<ChatPaths> => chat_paths(await scratch("turn-diff-store"), chat_id);

export const snap = async (root: string, paths: ChatPaths, index_repo: string | null = null): Promise<Snapshot> =>
  take_git_snapshot(await git_target(root), paths, root, index_repo, signal);

export const tree_files = (root: string, paths: ChatPaths, common_dir: string, tree: string): Record<string, string> => {
  const out = execFileSync(tool().exe, ["ls-tree", "-r", "-z", tree], { cwd: root, env: { ...process.env, ...snapshot_env(paths, common_dir, false) } }).toString("utf8");
  const files: Record<string, string> = {};
  for (const record of out.split("\0").filter(Boolean)) {
    const tab = record.indexOf("\t");
    const [mode, , oid] = record.slice(0, tab).split(" ");
    files[record.slice(tab + 1)] = mode === "160000" ? `commit ${oid}` : execFileSync(tool().exe, ["cat-file", "blob", oid ?? ""], { cwd: root, env: { ...process.env, ...snapshot_env(paths, common_dir, false) } }).toString("utf8");
  }
  return files;
};

export const object_count = async (dir: string): Promise<number> => {
  let count = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) count += 1;
  }
  return count;
};

export const common_dir_of = (root: string): string => path.resolve(root, execFileSync(tool().exe, ["rev-parse", "--git-common-dir"], { cwd: root }).toString("utf8").trim());
