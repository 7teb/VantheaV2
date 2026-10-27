import fs from "node:fs/promises";
import path from "node:path";
import { error_code, missing_path } from "../storage/coerce.ts";
import { guard_from, owned_scopes, parse_config_list, repo_config, split_key, type ConfigEntry } from "./guard.ts";
import { entry_kind, git_location } from "./repo.ts";
import { exec_git, git_ok, type GitTool } from "./run.ts";

export type RepoWriteGuard = { hooks: boolean; commit_block: string[]; push_block: string[] };

const signing_program = (key: string): boolean => {
  const { section, variable } = split_key(key);
  return section === "gpg" && (variable === "program" || variable === "defaultkeycommand");
};

export const owned_filters = (entries: ConfigEntry[]): string[] => [
  ...new Set(
    entries.flatMap((entry) => {
      const { section, subsection } = split_key(entry.key);
      return owned_scopes.has(entry.scope) && section === "filter" && subsection !== null ? [`filter.${subsection}`] : [];
    }),
  ),
];

export const read_owned_filters = async (tool: GitTool, root: string): Promise<string[]> => owned_filters(await repo_config(tool, root));

export const write_blocks = (entries: ConfigEntry[]): { commit: string[]; push: string[] } => {
  const signing = entries.flatMap((entry) => (owned_scopes.has(entry.scope) && signing_program(entry.key) ? [entry.key] : []));
  const commit = [...new Set([...owned_filters(entries), ...signing])];
  return { commit, push: [...new Set([...commit, ...guard_from(entries, []).program_keys])] };
};

export const configured_hooks_path = (entries: ConfigEntry[]): boolean =>
  Boolean(entries.findLast((entry) => entry.scope !== "command" && entry.key === "core.hookspath")?.value?.trim());

const hook_files = async (dir: string): Promise<boolean> => {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).some((entry) => !entry.isDirectory() && !entry.name.endsWith(".sample"));
  } catch (error) {
    if (!missing_path(error)) console.warn(`[git] listing ${dir} for hooks failed: ${error_code(error) || String(error)}`);
    return false;
  }
};

export const read_write_guard = async (tool: GitTool, root: string, signal?: AbortSignal): Promise<RepoWriteGuard> => {
  const output = await exec_git(tool, { cwd: root, args: ["config", "--list", "--show-scope", "-z"], signal });
  const entries = parse_config_list(git_ok(output, `git config --list in ${root}`).toString("utf8"), true);
  const blocks = write_blocks(entries);
  const location = await git_location(root);
  const hooks =
    configured_hooks_path(entries) ||
    (location !== null && ((await hook_files(path.join(location.common_dir, "hooks"))) || (await entry_kind(path.join(location.work_tree, ".husky"))) === "dir"));
  return { hooks, commit_block: blocks.commit, push_block: blocks.push };
};
