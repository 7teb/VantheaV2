import fs from "node:fs/promises";
import path from "node:path";
import type { FetchBlock } from "../../shared/git-view.ts";
import { error_code, missing_path } from "../storage/coerce.ts";
import { path_key } from "../storage/paths.ts";
import { entry_kind, fsmonitor_off, gitfile_target, type RepoPaths } from "./repo.ts";
import { exec_git, git_ok, type GitConfigPair, type GitTool } from "./run.ts";

export type ConfigEntry = { scope: string; key: string; value: string | null };

export type RemoteFetchConfig = { refspecs: string[]; mirror: boolean };

export type SshSettings = { command: ConfigEntry | null; variant: ConfigEntry | null };

export type GuardRules = {
  read_config: GitConfigPair[];
  partial_clone: boolean;
  program_keys: string[];
  remotes: Map<string, RemoteFetchConfig>;
  ssh: SshSettings;
};

type TreeLinks = { index: string; stamp: string; links: string[] };

export type GitGuard = GuardRules & { trees: TreeLinks[] };

export const owned_scopes = new Set(["local", "worktree"]);

const program_variables: Record<string, string> = {
  sshcommand: "sshCommand",
  alternaterefscommand: "alternateRefsCommand",
  gitproxy: "gitProxy",
};

export const parse_config_list = (text: string, scoped: boolean): ConfigEntry[] => {
  const tokens = text.split("\0");
  const entries: ConfigEntry[] = [];
  for (let index = 0; index < tokens.length; index += scoped ? 2 : 1) {
    const scope = scoped ? (tokens[index] ?? "") : "local";
    const pair = tokens[scoped ? index + 1 : index];
    if (!pair) continue;
    const newline = pair.indexOf("\n");
    entries.push(newline < 0 ? { scope, key: pair, value: null } : { scope, key: pair.slice(0, newline), value: pair.slice(newline + 1) });
  }
  return entries;
};

export const split_key = (key: string): { section: string; subsection: string | null; variable: string } => {
  const first = key.indexOf(".");
  const last = key.lastIndexOf(".");
  return { section: key.slice(0, first), subsection: first === last ? null : key.slice(first + 1, last), variable: key.slice(last + 1) };
};

export const git_bool = (value: string | null): boolean | null => {
  if (value === null) return true;
  const text = value.trim().toLowerCase();
  if (text === "" || text === "false" || text === "no" || text === "off") return false;
  if (text === "true" || text === "yes" || text === "on") return true;
  if (/^[+-]?\d+[kmg]?$/.test(text)) return Number.parseInt(text, 10) !== 0;
  return null;
};

const program_key = (key: string): string | null => {
  const { section, subsection, variable } = split_key(key);
  const runs =
    (section === "core" && subsection === null && ["sshcommand", "alternaterefscommand", "gitproxy"].includes(variable)) ||
    (section === "credential" && variable === "helper") ||
    (section === "protocol" && variable === "allow") ||
    (section === "remote" && subsection !== null && (variable === "uploadpack" || variable === "receivepack"));
  if (!runs) return null;
  return [section, subsection, program_variables[variable] ?? variable].filter((part) => part !== null).join(".");
};

export const guard_from = (repo: ConfigEntry[], submodules: ConfigEntry[]): GuardRules => {
  const owned = [...repo.filter((entry) => owned_scopes.has(entry.scope)), ...submodules];
  const read_config: GitConfigPair[] = [];
  if (owned.some((entry) => entry.key === "core.fsmonitor" && git_bool(entry.value) === null)) {
    read_config.push(["core.fsmonitor", "false"]);
  }
  const filters = new Set(owned.flatMap((entry) => {
    const { section, subsection } = split_key(entry.key);
    return section === "filter" && subsection !== null ? [subsection] : [];
  }));
  for (const name of [...filters].sort()) {
    read_config.push([`filter.${name}.clean`, ""], [`filter.${name}.process`, ""], [`filter.${name}.required`, "false"]);
  }
  const remotes = new Map<string, RemoteFetchConfig>();
  for (const entry of repo) {
    const { section, subsection, variable } = split_key(entry.key);
    if (section !== "remote" || subsection === null || (variable !== "fetch" && variable !== "mirror")) continue;
    const remote = remotes.get(subsection) ?? { refspecs: [], mirror: false };
    if (variable === "fetch" && entry.value) remote.refspecs.push(entry.value);
    if (variable === "mirror") remote.mirror = git_bool(entry.value) === true;
    remotes.set(subsection, remote);
  }
  return {
    read_config,
    partial_clone: repo.some((entry) => (entry.key === "extensions.partialclone" && Boolean(entry.value)) || (/^remote\..+\.promisor$/.test(entry.key) && git_bool(entry.value) === true)),
    program_keys: [...new Set(repo.filter((entry) => owned_scopes.has(entry.scope)).flatMap((entry) => program_key(entry.key) ?? []))],
    remotes,
    ssh: { command: repo.findLast((entry) => entry.key === "core.sshcommand") ?? null, variant: repo.findLast((entry) => entry.key === "ssh.variant") ?? null },
  };
};

const writes_local_refs = (refspec: string): boolean => {
  if (refspec.startsWith("^")) return false;
  const colon = refspec.indexOf(":");
  if (colon < 0) return false;
  const target = refspec.slice(colon + 1);
  return target !== "" && !target.startsWith("refs/remotes/") && !target.startsWith("refs/tags/");
};

export const fetch_block = (guard: GuardRules, remote: string): FetchBlock | null => {
  if (guard.program_keys.length > 0) return { kind: "repo_config", keys: guard.program_keys };
  const config = guard.remotes.get(remote);
  if (config?.mirror) return { kind: "local_refspec", key: `remote.${remote}.mirror` };
  if (config?.refspecs.some(writes_local_refs)) return { kind: "local_refspec", key: `remote.${remote}.fetch` };
  return null;
};

const index_stamp = async (file: string): Promise<string> => {
  try {
    const info = await fs.stat(file);
    return `${info.mtimeMs}:${info.size}`;
  } catch (error) {
    if (!missing_path(error)) console.warn(`[git] checking ${file} for gitlink changes failed: ${error_code(error) || String(error)}`);
    return "missing";
  }
};

const module_dirs = async (dir: string, found: string[]) => {
  if ((await entry_kind(path.join(dir, "HEAD"))) === "file" && (await entry_kind(path.join(dir, "config"))) === "file") {
    found.push(dir);
    await module_dirs(path.join(dir, "modules"), found);
    return;
  }
  let children: string[];
  try {
    children = (await fs.readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (!missing_path(error)) console.warn(`[git] listing ${dir} for submodule configuration failed: ${error_code(error) || String(error)}`);
    return;
  }
  for (const child of children) await module_dirs(path.join(dir, child), found);
};

const gitlinks = async (tool: GitTool, work_tree: string, signal?: AbortSignal): Promise<string[]> => {
  const raw = git_ok(await exec_git(tool, { cwd: work_tree, args: ["ls-files", "--stage", "-z"], flags: fsmonitor_off, signal }), `git ls-files in ${work_tree}`);
  return raw
    .toString("utf8")
    .split("\0")
    .flatMap((record) => (record.startsWith("160000 ") ? [record.slice(record.indexOf("\t") + 1)] : []));
};

const tree_links = async (tool: GitTool, work_tree: string, git_dir: string, known: TreeLinks[], signal?: AbortSignal): Promise<TreeLinks> => {
  const index = path.join(git_dir, "index");
  const stamp = await index_stamp(index);
  return known.find((entry) => entry.index === index && entry.stamp === stamp) ?? { index, stamp, links: await gitlinks(tool, work_tree, signal) };
};

const linked_git_dir = async (work_tree: string): Promise<string | null> => {
  const dot_git = path.join(work_tree, ".git");
  const kind = await entry_kind(dot_git);
  if (kind === "dir") return dot_git;
  return kind === "file" ? gitfile_target(dot_git) : null;
};

type Submodules = { trees: TreeLinks[]; work_trees: string[]; loose_dirs: string[] };

const find_submodules = async (tool: GitTool, paths: RepoPaths, known: TreeLinks[], signal?: AbortSignal): Promise<Submodules> => {
  const trees: TreeLinks[] = [];
  const work_trees: string[] = [];
  const covered = new Set<string>();
  const queue: [work_tree: string, git_dir: string][] = [[paths.top, paths.git_dir]];
  const seen = new Set([path_key(paths.top)]);
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const [tree, tree_git_dir] = next;
    const listed = await tree_links(tool, tree, tree_git_dir, known, signal);
    trees.push(listed);
    for (const link of listed.links) {
      const work_tree = path.join(tree, link);
      const git_dir = seen.has(path_key(work_tree)) ? null : await linked_git_dir(work_tree);
      if (!git_dir) continue;
      seen.add(path_key(work_tree));
      work_trees.push(work_tree);
      covered.add(path_key(git_dir));
      queue.push([work_tree, git_dir]);
    }
  }
  const modules: string[] = [];
  await module_dirs(path.join(paths.common_dir, "modules"), modules);
  return { trees, work_trees, loose_dirs: modules.filter((dir) => !covered.has(path_key(dir))) };
};

const repo_config = async (tool: GitTool, cwd: string, signal?: AbortSignal): Promise<ConfigEntry[]> => {
  const output = await exec_git(tool, { cwd, args: ["config", "--list", "--show-scope", "-z"], signal });
  return parse_config_list(git_ok(output, `git config --list in ${cwd}`).toString("utf8"), true);
};

const file_config = async (tool: GitTool, top: string, file: string, signal?: AbortSignal): Promise<ConfigEntry[]> => {
  const output = await exec_git(tool, { cwd: top, args: ["config", "--file", file, "--includes", "--list", "-z"], signal });
  if (output.code !== 0 && (await entry_kind(file)) === null) return [];
  return parse_config_list(git_ok(output, `git config --file ${file}`).toString("utf8"), false);
};

export const read_guard = async (tool: GitTool, paths: RepoPaths, previous: GitGuard | null, signal?: AbortSignal): Promise<GitGuard> => {
  const repo = await repo_config(tool, paths.top, signal);
  const { trees, work_trees, loose_dirs } = await find_submodules(tool, paths, previous?.trees ?? [], signal);
  const submodules: ConfigEntry[] = [];
  for (const work_tree of work_trees) {
    submodules.push(...(await repo_config(tool, work_tree, signal)).filter((entry) => owned_scopes.has(entry.scope)));
  }
  for (const dir of loose_dirs) {
    submodules.push(...(await file_config(tool, paths.top, path.join(dir, "config"), signal)));
  }
  return { ...guard_from(repo, submodules), trees };
};
