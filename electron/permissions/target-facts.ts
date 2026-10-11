import { execFile } from "node:child_process";
import type { BigIntStats, Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { to_posix } from "../project/scope.ts";
import { error_code, error_text, missing_path } from "../storage/coerce.ts";
import { git_location } from "./project-profile.ts";
import { dynamic_path, shell_source, words } from "./script-refs.ts";
import type { ScriptFile } from "./sources.ts";
import { split_statements } from "./statements.ts";

export type Target = { written: string; where: string | null; path: string };

export type TargetList = { targets: Target[]; unresolved: string[] };

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

const max_targets = 20;

const walk_entries = 2000;

const walk_ms = 150;

const listed_names = 20;

const git_timeout_ms = 2000;

const git_safety = ["--no-optional-locks", "-c", "core.fsmonitor=false"];

export const run_git: GitRunner = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout: git_timeout_ms, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });

const path_like = (token: string): boolean => /[\\/]/.test(token) || /\.[A-Za-z0-9]{1,8}$/.test(token);

const assignments = (command: string): Map<string, string> => {
  const found = new Map<string, string>();
  for (const statement of split_statements(command)) {
    const match = /^\s*\$([A-Za-z_]\w*)\s*=\s*(["'])([^"'$`]*)\2\s*$/.exec(statement);
    if (match) found.set((match[1] ?? "").toLowerCase(), match[3] ?? "");
  }
  return found;
};

const env_reference = /\$\{env:([^}]+)\}|\$env:(\w+)|%([A-Za-z_][\w()]*)%/gi;

const expand_env = (token: string): string =>
  token.replace(env_reference, (whole: string, braced?: string, plain?: string, percent?: string) => {
    const value = process.env[braced ?? plain ?? percent ?? ""];
    return value && !value.includes(path.delimiter) ? value : whole;
  });

const remote_path = (value: string): boolean => /^(?:\\\\|\/\/)/.test(value) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value);

const resolve_target = (base: string, value: string): string => (remote_path(value) ? value : path.resolve(base, value));

const failure = (error: unknown): string => error_code(error) || error_text(error);

const exists = async (file: string): Promise<boolean> => {
  try {
    await fs.stat(file);
    return true;
  } catch (error) {
    return !missing_path(error);
  }
};

export const command_targets = async (command: string, cwd: string, scripts: ScriptFile[]): Promise<TargetList> => {
  const targets: Target[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  const add = (written: string, where: string | null, absolute: string) => {
    const key = absolute.toLowerCase();
    if (seen.has(key) || targets.length >= max_targets) return;
    seen.add(key);
    targets.push({ written, where, path: absolute });
  };
  const statement_targets = async (text: string, base: string, where: (statement: string) => string | null) => {
    const values = assignments(text);
    for (const statement of split_statements(text)) {
      if (/^\s*\$[A-Za-z_]\w*\s*=/.test(statement)) continue;
      for (const token of words(statement).slice(1)) {
        if (token.startsWith("-") || /^\/[a-z?]{1,3}$/i.test(token) || /^\d+$/.test(token)) continue;
        const literal = expand_env(token);
        if (dynamic_path.test(literal)) {
          const variable = /^\$([A-Za-z_]\w*)$/.exec(token)?.[1]?.toLowerCase();
          const value = variable ? values.get(variable) : undefined;
          if (value) add(token, `${where(statement) ?? "command"}, = '${value}'`, resolve_target(base, value));
          else if (/[\\/.]/.test(token) && unresolved.length < max_targets) unresolved.push(token);
          continue;
        }
        if (path_like(literal) || remote_path(literal) || (/^[\w.-]+$/.test(literal) && (await exists(path.resolve(base, literal))))) {
          add(token, where(statement), resolve_target(base, literal));
        }
      }
    }
  };
  await statement_targets(command, cwd, () => null);
  for (const script of scripts) {
    if (!script.text || !script.abs) continue;
    if (shell_source.test(script.abs)) {
      const lines = script.text.split(/\r?\n/);
      for (const [index, line] of lines.entries()) await statement_targets(line, cwd, () => `${script.path} line ${index + 1}`);
      continue;
    }
    for (const [index, line] of script.text.split(/\r?\n/).entries()) {
      for (const match of line.matchAll(/(["'])((?:\.{1,2}[\\/]|[A-Za-z]:[\\/])[^"'\r\n]*|[\w.-]+[\\/][^"'\r\n]*\.[A-Za-z0-9]{1,8})\1/g)) {
        const literal = match[2] ?? "";
        if (dynamic_path.test(literal)) continue;
        const base = /^\.{1,2}[\\/]/.test(literal) ? path.dirname(script.abs) : cwd;
        add(literal, `${script.path} line ${index + 1}`, resolve_target(base, literal));
      }
    }
  }
  return { targets, unresolved };
};

type Shape =
  | { kind: "file"; bytes: number }
  | { kind: "directory"; count: number; complete: boolean; names: string[]; unread: string[] }
  | { kind: "missing" }
  | { kind: "unreadable"; failure: string }
  | { kind: "remote" };

const list_dir = async (dir: string, unread: string[]): Promise<Dirent[]> => {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    unread.push(`${dir} (${failure(error)})`);
    return [];
  }
};

const count_entries = async (dir: string): Promise<Shape> => {
  const deadline = Date.now() + walk_ms;
  const unread: string[] = [];
  const top = await list_dir(dir, unread);
  const names = top.slice(0, listed_names + 1).map((entry) => entry.name);
  let count = 0;
  const pending = [dir];
  while (pending.length) {
    if (count >= walk_entries || Date.now() > deadline) {
      return { kind: "directory", count, complete: false, names: [], unread };
    }
    const current = pending.pop() ?? "";
    for (const entry of current === dir ? top : await list_dir(current, unread)) {
      count += 1;
      if (entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules") pending.push(path.join(current, entry.name));
    }
  }
  return { kind: "directory", count, complete: unread.length === 0, names: names.length <= listed_names ? names : [], unread };
};

const shape_of = async (target: string): Promise<Shape> => {
  if (remote_path(target)) return { kind: "remote" };
  let info: Stats;
  try {
    info = await fs.stat(target);
  } catch (error) {
    return missing_path(error) ? { kind: "missing" } : { kind: "unreadable", failure: failure(error) };
  }
  return info.isDirectory() ? count_entries(target) : { kind: "file", bytes: info.size };
};

const shape_text = (shape: Shape): string => {
  if (shape.kind === "remote") return "network or remote location, not read";
  if (shape.kind === "missing") return "does not exist";
  if (shape.kind === "unreadable") return `could not be read (${shape.failure})`;
  if (shape.kind === "file") return `file, ${shape.bytes} bytes`;
  const count = shape.complete ? `${shape.count} entries` : `more than ${shape.count} entries`;
  const unread = shape.unread.length ? `, not listed: ${shape.unread.slice(0, 3).join(", ")}` : "";
  return `directory, ${count}${shape.names.length ? ` (${shape.names.join(", ")})` : ""}${unread}`;
};

type IndexEntry = { mtime_ns: bigint; size: number };

type GitFacts = { tracked: Map<string, IndexEntry>; untracked: Set<string>; index_mtime_ns: bigint } | { error: string };

const split_z = (text: string): string[] => text.split("\0").filter(Boolean);

const index_entries = (text: string): Map<string, IndexEntry> => {
  const entries = new Map<string, IndexEntry>();
  for (const match of text.matchAll(/([^\0\n]+)\0\s*ctime: \d+:\d+\n\s*mtime: (\d+):(\d+)\n[\s\S]*?size: (\d+)/g)) {
    entries.set((match[1] ?? "").toLowerCase(), { mtime_ns: BigInt(match[2] ?? "0") * 1000000000n + BigInt(match[3] ?? "0"), size: Number(match[4] ?? "0") });
  }
  return entries;
};

const stat_if_present = async (file: string): Promise<BigIntStats | null> => {
  try {
    return await fs.stat(file, { bigint: true });
  } catch (error) {
    if (missing_path(error)) return null;
    throw error;
  }
};

const git_facts = async (work_tree: string, git_dir: string, relative: string[], git: GitRunner): Promise<GitFacts> => {
  const cached = [...git_safety, "ls-files", "--debug", "-z", "--cached", "--", ...relative];
  const others = [...git_safety, "ls-files", "-z", "--others", "--exclude-standard", "--", ...relative];
  try {
    const [listed, untracked, index] = await Promise.all([git(cached, work_tree), git(others, work_tree), stat_if_present(path.join(git_dir, "index"))]);
    return { tracked: index_entries(listed), untracked: new Set(split_z(untracked).map((entry) => entry.toLowerCase())), index_mtime_ns: index?.mtimeNs ?? 0n };
  } catch (error) {
    console.warn(`[permissions] target facts git read failed in ${work_tree} (git ${cached.join(" ")}): ${error_text(error)}`);
    return { error: error_text(error).split(/\r?\n/)[0] ?? "unknown error" };
  }
};

const worktree_state = async (file: string, entry: IndexEntry, index_mtime_ns: bigint): Promise<string> => {
  let info: BigIntStats | null;
  try {
    info = await stat_if_present(file);
  } catch (error) {
    return `state unknown (${failure(error)})`;
  }
  if (!info || Number(info.size) !== entry.size) return "modified";
  const same_time = entry.mtime_ns % 1000000000n === 0n ? info.mtimeNs / 1000000000n === entry.mtime_ns / 1000000000n : info.mtimeNs === entry.mtime_ns;
  return !same_time || entry.mtime_ns >= index_mtime_ns ? "modified" : "unmodified";
};

const git_text = async (facts: GitFacts, relative: string, file: string, shape: Shape): Promise<string> => {
  if ("error" in facts) return `git facts unavailable: ${facts.error}`;
  const key = relative.toLowerCase();
  if (shape.kind === "directory") {
    const inside = (names: Iterable<string>) => [...names].filter((entry) => entry.startsWith(`${key}/`) || key === "").length;
    return `git: ${inside(facts.tracked.keys())} tracked, ${inside(facts.untracked)} untracked`;
  }
  if (facts.untracked.has(key)) return "git: untracked";
  const entry = facts.tracked.get(key);
  if (!entry) return "git: not in the index";
  return `git: tracked, ${await worktree_state(file, entry, facts.index_mtime_ns)}`;
};

export const target_facts = async (list: TargetList, git: GitRunner = run_git): Promise<string[]> => {
  const shapes = await Promise.all(list.targets.map((target) => shape_of(target.path)));
  const trees = new Map<string, { work_tree: string; git_dir: string; indexes: number[] }>();
  for (const [index, target] of list.targets.entries()) {
    const shape = shapes[index]?.kind;
    if (shape === "remote") continue;
    const location = await git_location(shape === "missing" ? path.dirname(target.path) : target.path);
    if (!location) continue;
    const tree = trees.get(location.work_tree) ?? { work_tree: location.work_tree, git_dir: location.git_dir, indexes: [] };
    tree.indexes.push(index);
    trees.set(location.work_tree, tree);
  }
  const git_by_index = new Map<number, string>();
  await Promise.all(
    [...trees.values()].map(async (tree) => {
      const relative = tree.indexes.map((index) => to_posix(path.relative(tree.work_tree, list.targets[index]?.path ?? "")) || ".");
      const facts = await git_facts(tree.work_tree, tree.git_dir, relative, git);
      for (const [at, index] of tree.indexes.entries()) {
        const name = relative[at] === "." ? "" : (relative[at] ?? "");
        git_by_index.set(index, await git_text(facts, name, list.targets[index]?.path ?? "", shapes[index] ?? { kind: "missing" }));
      }
    }),
  );
  const lines = list.targets.map((target, index) => {
    const where = target.where ? ` (${target.where})` : "";
    const git_part = git_by_index.get(index);
    return `${target.written}${where}: ${target.path}, ${shape_text(shapes[index] ?? { kind: "missing" })}${git_part ? `, ${git_part}` : ""}`;
  });
  return [...lines, ...list.unresolved.map((text) => `unresolved: ${text}`)];
};
