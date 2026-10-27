import { spawn } from "node:child_process";
import { strip_userinfo } from "../../shared/git/remote-url.ts";
import { kill_tree } from "../shell/process.ts";

export type GitVersion = [number, number, number];

export type GitTool = { exe: string; version: string; numbers: GitVersion; local_env: string[] };

export type GitConfigPair = [key: string, value: string];

export type GitCall = {
  cwd: string;
  args: string[];
  flags?: string[];
  config?: GitConfigPair[];
  literal_paths?: boolean;
  env?: Record<string, string>;
  hooks?: boolean;
  input?: Buffer;
  signal?: AbortSignal;
  on_exit?: () => void;
};

export type GitOutput = { code: number; stdout: Buffer; stderr: string };

type ProgramRun = { cwd: string; env: NodeJS.ProcessEnv; input?: Buffer; signal?: AbortSignal; on_exit?: () => void };

const bare_flags = ["-c", "safe.bareRepository=explicit"];

export const base_flags = ["-c", "core.hooksPath=NUL", ...bare_flags];

export const write_hooks = false;

const fixed_env: Record<string, string> = {
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  GCM_INTERACTIVE: "never",
  LC_ALL: "C",
  LANGUAGE: "C",
  GIT_NO_LAZY_FETCH: "1",
};

const config_env = (config: GitConfigPair[]): Record<string, string> => {
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(config.length) };
  for (const [index, [key, value]] of config.entries()) {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  }
  return env;
};

const pathspec_env = ["GIT_GLOB_PATHSPECS", "GIT_NOGLOB_PATHSPECS", "GIT_ICASE_PATHSPECS"];

export const git_env = (source: NodeJS.ProcessEnv, local_env: string[], config: GitConfigPair[] = [], literal_paths = false, added: Record<string, string> = {}): NodeJS.ProcessEnv => {
  const extra = { ...added, ...fixed_env, ...(config.length > 0 ? config_env(config) : {}), ...(literal_paths ? { GIT_LITERAL_PATHSPECS: "1" } : {}) };
  const dropped = new Set([...local_env, ...Object.keys(extra), ...(literal_paths ? pathspec_env : [])].map((name) => name.toUpperCase()));
  const kept = Object.entries(source).filter(([name]) => !dropped.has(name.toUpperCase()) && !/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/i.test(name));
  return { ...Object.fromEntries(kept), ...extra };
};

export const run_program = (exe: string, args: string[], run: ProgramRun): Promise<GitOutput> =>
  new Promise((resolve, reject) => {
    const { signal } = run;
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const options = { cwd: run.cwd, env: run.env, windowsHide: true, shell: false };
    const child = run.input ? spawn(exe, args, { ...options, stdio: ["pipe", "pipe", "pipe"] }) : spawn(exe, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    if (run.input) {
      child.stdin?.on("error", (error) => console.warn(`[git] writing the input of ${exe} ${args.join(" ")} in ${run.cwd} failed: ${error.message}`));
      child.stdin?.end(run.input);
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const abort = () => {
      kill_tree(child.pid);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      signal?.removeEventListener("abort", abort);
      run.on_exit?.();
      reject(new Error(`starting ${exe} ${args.join(" ")} in ${run.cwd} failed: ${error.message}`, { cause: error }));
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      run.on_exit?.();
      resolve({ code: code ?? -1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });

export const exec_git = (tool: GitTool, call: GitCall): Promise<GitOutput> =>
  run_program(tool.exe, [...(call.hooks ? bare_flags : base_flags), ...(call.flags ?? []), ...call.args], {
    cwd: call.cwd,
    env: git_env(process.env, tool.local_env, call.config, call.literal_paths, call.env),
    input: call.input,
    signal: call.signal,
    on_exit: call.on_exit,
  });

export type LineBatch = { lines: string[]; done: boolean };

export type GitLines = { read: (count: number) => Promise<LineBatch>; close: () => void };

type LineWaiter = { count: number; resolve: (batch: LineBatch) => void; reject: (error: unknown) => void };

const newline = 10;

export const stream_git = (tool: GitTool, call: GitCall, what: string): GitLines => {
  const child = spawn(tool.exe, [...base_flags, ...(call.flags ?? []), ...call.args], {
    cwd: call.cwd,
    env: git_env(process.env, tool.local_env, call.config, call.literal_paths),
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines: string[] = [];
  const stderr: Buffer[] = [];
  let rest: Buffer = Buffer.alloc(0);
  let ended = false;
  let closed = false;
  let failure: Error | null = null;
  let waiter: LineWaiter | null = null;

  const push_line = (bytes: Buffer, start: number, end: number) => lines.push(bytes.toString("utf8", start, end).replace(/\r$/, ""));

  const settle = () => {
    const current = waiter;
    if (!current || (!failure && !ended && lines.length <= current.count)) return;
    waiter = null;
    child.stdout.pause();
    if (failure) {
      current.reject(failure);
      return;
    }
    const taken = lines.splice(0, current.count);
    current.resolve({ lines: taken, done: ended && lines.length === 0 });
  };

  const close = () => {
    if (closed) return;
    closed = true;
    call.signal?.removeEventListener("abort", close);
    if (!ended) {
      kill_tree(child.pid);
      child.stdout.destroy();
      child.stderr.destroy();
    }
    const current = waiter;
    waiter = null;
    current?.reject(new Error(`${what} was closed`));
  };

  child.stdout.on("data", (chunk: Buffer) => {
    const bytes = rest.length > 0 ? Buffer.concat([rest, chunk]) : chunk;
    let start = 0;
    for (let at = bytes.indexOf(newline); at >= 0; at = bytes.indexOf(newline, start)) {
      push_line(bytes, start, at);
      start = at + 1;
    }
    rest = bytes.subarray(start);
    settle();
  });
  child.stdout.pause();
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.on("error", (error) => {
    ended = true;
    failure = new Error(`starting ${what} failed: ${error.message}`, { cause: error });
    settle();
  });
  child.on("close", (code) => {
    if (closed) return;
    if (rest.length > 0) push_line(rest, 0, rest.length);
    rest = Buffer.alloc(0);
    ended = true;
    if (code !== 0) failure ??= new Error(`${what} exited with ${code ?? -1}: ${error_line(Buffer.concat(stderr).toString("utf8")) || "no error output"}`);
    call.signal?.removeEventListener("abort", close);
    settle();
  });
  call.signal?.addEventListener("abort", close, { once: true });
  if (call.signal?.aborted) close();

  return {
    read: (count) =>
      new Promise((resolve, reject) => {
        if (closed || waiter) {
          reject(new Error(closed ? `${what} was closed` : `${what} is already being read`));
          return;
        }
        waiter = { count, resolve, reject };
        settle();
        if (waiter) child.stdout.resume();
      }),
    close,
  };
};

const stderr_lines = (stderr: string): string[] =>
  stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

export const first_line = (stderr: string): string => strip_userinfo(stderr_lines(stderr)[0] ?? "");

export const error_line = (stderr: string): string => {
  const lines = stderr_lines(stderr);
  return strip_userinfo(lines.find((line) => /^(?:fatal|error):/i.test(line)) ?? lines[0] ?? "");
};

export const git_ok = (output: GitOutput, what: string): Buffer => {
  if (output.code === 0) {
    return output.stdout;
  }
  const line = error_line(output.stderr);
  throw Object.assign(new Error(`${what} exited with ${output.code}: ${line || "no error output"}`), { git_line: line });
};

export const git_failure_line = (error: unknown): string | null =>
  error instanceof Error && "git_line" in error && typeof error.git_line === "string" ? error.git_line : null;
