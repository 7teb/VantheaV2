import { spawn, type ChildProcess, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { error_text } from "../storage/coerce.ts";
import { claude_env } from "./env.ts";
import { claude_executable } from "./executable.ts";

type ClaudeSpawnOptions = {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string | undefined>;
  signal?: AbortSignal;
};

type ClaudeChild = ChildProcessByStdio<Writable, Readable, Readable>;

export type ClaudeRun = { code: number | null; stdout: string; stderr: string };

const stderr_tail_chars = 2048;

const live_children = new Set<ChildProcess>();

const stderr_tails = new WeakMap<ChildProcess, string>();

export const spawn_claude = (options: ClaudeSpawnOptions): ClaudeChild => {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  live_children.add(child);
  stderr_tails.set(child, "");
  const forget = () => {
    live_children.delete(child);
  };
  child.once("exit", forget);
  child.on("error", forget);
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr_tails.set(child, `${stderr_tails.get(child) ?? ""}${chunk}`.slice(-stderr_tail_chars));
  });
  child.stderr.on("error", (error) => console.warn(`[claude] reading stderr of ${options.command} failed:`, error_text(error)));
  return child;
};

export const stderr_tail_of = (child: ChildProcess): string => stderr_tails.get(child) ?? "";

export const run_claude = (args: string[]): Promise<ClaudeRun> =>
  new Promise((resolve, reject) => {
    const command = claude_executable();
    const child = spawn_claude({ command, args, env: claude_env() });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdin.on("error", (error) => console.warn(`[claude] writing to ${command} ${args.join(" ")} failed:`, error_text(error)));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end();
  });

export const kill_claude_children = (): void => {
  for (const child of [...live_children]) {
    child.kill();
  }
};
