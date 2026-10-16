import fs from "node:fs";
import path from "node:path";
import { locate_git_bash, type GitBashProbe } from "../shell/git-bash.ts";
import { system_probe } from "../shell/git-bash-probe.ts";
import { error_code, missing_path } from "../storage/coerce.ts";
import { git_env, git_ok, run_program, type GitTool, type GitVersion } from "./run.ts";

export type GitStamp = { mtime_ms: number; size: number };

export type GitLocateProbe = GitBashProbe & {
  stamp: (file: string) => GitStamp | null;
  run: (exe: string, args: string[]) => Promise<string>;
};

export type GitFound = { kind: "missing" } | { kind: "found"; tool: GitTool; stamp: GitStamp | null };

export const minimum_git: GitVersion = [2, 33, 0];

export const partial_clone_git: GitVersion = [2, 45, 0];

export const absolute_windows = /^(?:[a-z]:[\\/]|\\\\)/i;

export const parse_git_version = (text: string): GitVersion | null => {
  const match = /^git version (\d+)\.(\d+)\.(\d+)/.exec(text.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

export const version_at_least = (numbers: GitVersion, needed: GitVersion): boolean => {
  for (const [index, value] of numbers.entries()) {
    const want = needed[index] ?? 0;
    if (value !== want) return value > want;
  }
  return true;
};

export const env_value = (env: Record<string, string | undefined>, name: string): string =>
  Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? "";

export const path_program = (env: Record<string, string | undefined>, exists: (file: string) => boolean, name: string): string | null => {
  for (const raw of env_value(env, "PATH").split(";")) {
    const dir = raw.trim().replace(/^"(.*)"$/, "$1");
    if (!absolute_windows.test(dir)) continue;
    const exe = path.win32.join(dir, name);
    if (exists(exe)) return exe;
  }
  return null;
};

export const find_git_exe = async (probe: GitLocateProbe): Promise<string | null> => {
  const bash = await locate_git_bash(probe);
  if (bash) {
    const exe = path.win32.join(path.win32.dirname(path.win32.dirname(bash)), "cmd", "git.exe");
    if (absolute_windows.test(exe) && probe.exists(exe)) return exe;
  }
  return path_program(probe.env, probe.exists, "git.exe");
};

export const locate_git = async (probe: GitLocateProbe): Promise<GitFound> => {
  const exe = await find_git_exe(probe);
  if (!exe) {
    return { kind: "missing" };
  }
  const stamp = probe.stamp(exe);
  const text = await probe.run(exe, ["--version"]);
  const numbers = parse_git_version(text);
  if (!numbers) {
    throw new Error(`${exe} --version printed an unknown format: ${text.trim().slice(0, 200)}`);
  }
  const local_env = (await probe.run(exe, ["rev-parse", "--local-env-vars"]))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { kind: "found", tool: { exe, version: numbers.join("."), numbers, local_env }, stamp };
};

const same_stamp = (left: GitStamp | null, right: GitStamp | null): boolean =>
  left !== null && right !== null && left.mtime_ms === right.mtime_ms && left.size === right.size;

export const recheck_git = (probe: GitLocateProbe, current: GitFound, needed: GitVersion, registry: boolean): Promise<GitFound> | null => {
  if (current.kind === "missing") {
    return locate_git(registry ? probe : { ...probe, install_path: async () => null });
  }
  if (version_at_least(current.tool.numbers, needed) || same_stamp(probe.stamp(current.tool.exe), current.stamp)) {
    return null;
  }
  return locate_git(probe);
};

const file_stamp = (file: string): GitStamp | null => {
  try {
    const info = fs.statSync(file);
    return { mtime_ms: info.mtimeMs, size: info.size };
  } catch (error) {
    if (!missing_path(error)) console.warn(`[git] reading the size and time of ${file} failed: ${error_code(error) || String(error)}`);
    return null;
  }
};

const run_plain = async (exe: string, args: string[]): Promise<string> =>
  git_ok(await run_program(exe, args, { cwd: path.dirname(exe), env: git_env(process.env, []) }), `${exe} ${args.join(" ")}`).toString("utf8");

const default_probe: GitLocateProbe = { ...system_probe, stamp: file_stamp, run: run_plain };

let found: Promise<GitFound> | null = null;

const remember = (next: Promise<GitFound>): Promise<GitFound> => {
  found = next;
  next.catch((error) => {
    console.error("[git] locating git.exe failed:", error);
    if (found === next) found = null;
  });
  return next;
};

export const git_tool = (): Promise<GitFound> => found ?? remember(locate_git(default_probe));

export const recheck_git_tool = async (needed: GitVersion, registry: boolean): Promise<GitFound> => {
  const current = await git_tool();
  const next = recheck_git(default_probe, current, needed, registry);
  return next ? remember(next) : current;
};

export const require_git_tool = async (): Promise<GitTool> => {
  const current = await git_tool();
  if (current.kind === "missing") {
    throw new Error("Git for Windows is not installed");
  }
  return current.tool;
};
