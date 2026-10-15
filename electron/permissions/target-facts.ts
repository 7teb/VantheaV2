import { execFile } from "node:child_process";
import type { BigIntStats, Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { to_posix } from "../project/scope.ts";
import { error_code, error_text, missing_path } from "../storage/coerce.ts";
import { walk_command, type Step, type StepWord } from "./command-walk.ts";
import { location_matches, type ProgramFact } from "./launch-targets.ts";
import { msys_mounts, msys_native } from "./msys-paths.ts";
import { git_location } from "./project-profile.ts";
import { change_text } from "./review-action.ts";
import { dynamic_path, script_dialect, shell_source } from "./script-refs.ts";
import { shell_words, type Word } from "./shell-words.ts";
import type { ScriptFile } from "./sources.ts";
import type { Dialect } from "./statements.ts";

export type Target = { written: string; where: string | null; path: string };

export type TargetList = { targets: Target[]; unresolved: string[] };

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

const max_targets = 20;

const walk_entries = 2000;

const walk_ms = 150;

const listed_names = 20;

const git_timeout_ms = 2000;

const git_safety = ["--no-optional-locks", "-c", "core.fsmonitor=false"];

const program_kinds: Record<ProgramFact["kind"], string> = {
  native: "native executable",
  missing: "does not exist",
  network: "network path, not checked",
  script: "script, unchanged in this chat, not read",
  installed: "installed, not read",
  not_found: "not found on PATH",
  command: "no file of that name on PATH",
  powershell_command: "not a file on PATH, runs as a PowerShell function, alias or module command of that name if one exists",
  builtin: "PowerShell built-in command, not a file",
  unresolved_folder: "native executable by name, its folder is not known",
  unreadable: "could not be read",
};

export const run_git: GitRunner = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout: git_timeout_ms, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });

const path_like = (token: string): boolean => /[\\/]/.test(token) || /\.[A-Za-z0-9]{1,8}$/.test(token);

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

const option_target = (value: string, quoted: boolean, dialect: Dialect): string | null => {
  if (!value || /^\d+$/.test(value)) return null;
  if (value.startsWith("-")) {
    const option = /^-[A-Za-z][\w-]*:(.+)$/.exec(value)?.[1] ?? "";
    return path_like(option) ? option : null;
  }
  if (value.startsWith("/")) {
    if (dialect !== "cmd" && (value === "/" || /^\/[^/\\:]{2,}\//.test(value))) return value;
    if (/^\/[A-Za-z][\w+]*(?::[^\\/.]*)?$/.test(value)) return null;
    return /^\/[A-Za-z][\w+]*?:?([A-Za-z]:[\\/].*)$/.exec(value)?.[1] ?? /^\/[A-Za-z]+:(.+)$/.exec(value)?.[1] ?? null;
  }
  const text = value.startsWith("@") && (quoted || dialect === "cmd") ? value.slice(1) : value;
  return text && !/[|<>"]/.test(text) && (!/\s/.test(text) || /^(?:[A-Za-z]:[\\/]|\\\\|\.{1,2}[\\/])/.test(text)) ? text : null;
};

const unquoted = (raw: string): string => (/^'[^']*'$|^"[^"]*"$/.test(raw) ? raw.slice(1, -1) : raw);

const head_words = (step: Step): number => {
  const first = (step.words[0]?.word.raw ?? "").toLowerCase().replace(/^@+/, "");
  if (step.dialect === "cmd") return first === "call" ? 2 : 1;
  if (step.dialect === "posix") return first === "source" || first === "." ? 2 : 1;
  return first === "&" || first === "." ? 2 : 1;
};

const static_call_arguments = (step: Step): StepWord[] =>
  step.words.flatMap((entry, index) => {
    const call = step.words[index + 1];
    const group = call?.word.pieces[0];
    if (!/^\[[\w.]+\]::\w+$/.test(entry.word.raw) || !call?.word.glued || !call.items || group?.kind !== "group") return [];
    const items: Word[][] = [[]];
    for (const word of shell_words(group.text, "powershell", "expression")) {
      if (word.op === ",") items.push([]);
      else items.at(-1)?.push(word);
    }
    return call.items.flatMap((value, at) => {
      const words = items[at] ?? [];
      const first = words[0];
      return first ? [{ word: { ...first, raw: words.map((word) => word.raw).join(" ") }, value, items: null }] : [];
    });
  });

const value_after = (step: Step, raw: string): boolean => {
  const program = (step.words[head_words(step) - 1]?.word.raw ?? "").split(/[\\/]/).pop()?.toLowerCase().replace(/\.exe$/, "") ?? "";
  if (step.dialect === "powershell" && /^-(?:filter|include|exclude):?$/i.test(raw)) return true;
  if (/^(?:python[\d.]*|py)$/.test(program)) return raw === "-c" || raw === "-m";
  return /^(?:node|tsx|ts-node)$/.test(program) && /^(?:-e|--eval|-p|--print)$/.test(raw);
};

const argument_words = (step: Step): StepWord[] => {
  if (step.payload?.walked && "values" in step.payload.value) return [];
  if (!step.command && step.dialect === "powershell") return static_call_arguments(step);
  if (!step.command && step.dialect !== "cmd") return [];
  if (step.dialect === "powershell" && /^join-path$/i.test(step.words[0]?.word.raw ?? "")) return [];
  const words = step.words.slice(head_words(step));
  return words.filter((entry, index) => !entry.word.op && entry.word.pieces[0]?.kind !== "block" && !value_after(step, words[index - 1]?.word.raw ?? ""));
};

export const command_targets = async (command: string, cwd: string, scripts: ScriptFile[], env: Record<string, string | undefined> = process.env, shell: Dialect = "powershell"): Promise<TargetList> => {
  const targets: Target[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  const add = (written: string, where: string | null, absolute: string) => {
    const key = absolute.toLowerCase();
    if (seen.has(key) || targets.length >= max_targets) return;
    seen.add(key);
    targets.push({ written, where, path: absolute });
  };
  const unresolved_word = (written: string) => {
    if (/[\\/.]/.test(written) && unresolved.length < max_targets && !unresolved.includes(written)) unresolved.push(written);
  };
  const mounts = msys_mounts();
  const step_targets = async (step: Step, where: string | null) => {
    const bases = "values" in step.location ? step.location.values : null;
    for (const entry of argument_words(step)) {
      const raw = unquoted(entry.word.raw);
      if ("unresolved" in entry.value) {
        if (!raw.startsWith("-")) unresolved_word(raw);
        continue;
      }
      const piece = entry.word.pieces[0];
      const quoted = piece?.kind === "text" && piece.quote !== "none" && piece.quote !== "verbatim";
      const variable = /^\$\{?[A-Za-z_]\w*\}?$/.test(raw);
      for (const value of entry.value.values) {
        const native = step.dialect === "posix" ? msys_native(value, mounts) : value;
        const text = native === null ? null : option_target(native, quoted, step.dialect);
        if (!text) continue;
        const remote = remote_path(text);
        if (!remote && !path.win32.isAbsolute(text) && !bases) {
          unresolved_word(raw);
          continue;
        }
        const shown = variable ? `${where ?? "command"}, = '${value}'` : where;
        for (const base of remote ? [cwd] : (bases ?? [cwd])) {
          if (remote || path_like(text) || (/^[\w.-]+$/.test(text) && (await exists(path.resolve(base, text))))) add(raw, shown, resolve_target(base, text));
        }
      }
    }
  };
  const walked = async (text: string, dialect: Dialect, script_path: string, where: (step: Step) => string | null) => {
    for (const step of walk_command(text, { location: cwd, dialect, env, script_path, matches: location_matches })) await step_targets(step, where(step));
  };
  await walked(command, shell, "", () => null);
  for (const script of scripts) {
    if (!script.text || !script.abs) continue;
    if (shell_source.test(script.abs)) {
      await walked(script.text, script_dialect(script.abs) ?? "powershell", script.abs, (step) => `${script.path} line ${step.line}`);
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

export const program_lines = (programs: ProgramFact[], notes: string[], scripts: ScriptFile[]): string[] => [
  ...programs.map((fact) => {
    const origin = fact.origin ? `${scripts.find((script) => script.abs === fact.origin)?.path || fact.origin} line ${fact.line}` : "";
    const how = [fact.how, origin].filter(Boolean).join(", ");
    const parts = [
      fact.path,
      program_kinds[fact.kind],
      ...(fact.bytes !== null ? [`${fact.bytes} bytes`] : []),
      ...(fact.outside ? ["outside the project"] : []),
      ...(fact.change ? [change_text(fact.change)] : []),
    ];
    return `started ${unquoted(fact.written)}${how ? ` (${how})` : ""}: ${parts.join(", ")}`;
  }),
  ...notes.map((text) => `note: ${text}`),
];

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
