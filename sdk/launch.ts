import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { api_version } from "../shared/api/contract.ts";
import { create_client, type Client } from "./client.ts";

export type LaunchOptions = {
  exe_path?: string;
  args?: string[];
  data_dir?: string;
  openrouter_key?: string;
  port?: number;
  signal?: AbortSignal;
};

export type Vantheax = { client: Client; url: string; close: () => Promise<void> };

type ReadyLine = { url: string; api: number; pid: number };

const loopback_url = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;

export const parse_ready_line = (line: string): ReadyLine | null => {
  if (!line.trimStart().startsWith("{")) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || !("vantheax" in value) || value.vantheax !== "ready") {
    return null;
  }
  const url = "url" in value ? value.url : undefined;
  const api = "api" in value ? value.api : undefined;
  const pid = "pid" in value ? value.pid : undefined;
  if (typeof url !== "string" || !loopback_url.test(url) || typeof api !== "number" || typeof pid !== "number") {
    return null;
  }
  return { url, api, pid };
};

export const launch_args = (options: LaunchOptions): string[] => [
  ...(options.args ?? []),
  "--vx-serve",
  `--vx-port=${options.port ?? 0}`,
  "--vx-lease=stdin",
  ...(options.data_dir ? [`--vx-data-dir=${options.data_dir}`] : []),
];

export const create_vantheax = async (options: LaunchOptions = {}): Promise<Vantheax> => {
  const exe_path = options.exe_path ?? process.env.VANTHEAX_EXE;
  if (!exe_path) {
    throw new Error("no VantheaX executable: pass exe_path or set VANTHEAX_EXE");
  }
  options.signal?.throwIfAborted();
  const token = randomBytes(32).toString("hex");
  const openrouter_key = options.openrouter_key ?? process.env.OPENROUTER_API_KEY;
  const child = spawn(exe_path, launch_args(options), {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, VANTHEAX_API_TOKEN: token, ...(openrouter_key ? { OPENROUTER_API_KEY: openrouter_key } : {}) },
    windowsHide: true,
  });
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });
  const close = (): Promise<void> => {
    if (child.exitCode === null && child.signalCode === null && child.stdin.writable) {
      child.stdin.end();
    }
    return exited;
  };
  let fail_pending: ((error: unknown) => void) | null = null;
  const on_abort = () => {
    fail_pending?.(options.signal?.reason);
    void close();
  };
  options.signal?.addEventListener("abort", on_abort, { once: true });
  void exited.then(() => options.signal?.removeEventListener("abort", on_abort));
  const ready = await new Promise<ReadyLine>((resolve, reject) => {
    let stderr = "";
    let settled = false;
    const settle = (outcome: () => void) => {
      if (!settled) {
        settled = true;
        fail_pending = null;
        outcome();
      }
    };
    fail_pending = (error) => settle(() => reject(error));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text: string) => {
      if (!settled) {
        stderr += text;
      }
    });
    createInterface({ input: child.stdout }).on("line", (line) => {
      if (settled) {
        return;
      }
      const found = parse_ready_line(line);
      if (!found) {
        return;
      }
      if (found.api !== api_version) {
        settle(() => reject(new Error(`VantheaX at ${found.url} speaks API ${found.api}, this SDK speaks API ${api_version}`)));
        void close();
        return;
      }
      settle(() => resolve(found));
    });
    child.stdin.on("error", (error) => settle(() => reject(new Error(`VantheaX stdin failed before it was ready: ${error.message}`))));
    child.once("error", (error) => settle(() => reject(new Error(`VantheaX could not be started from ${exe_path}: ${error.message}`))));
    child.once("close", (code, signal) => {
      const detail = stderr.trim() ? `: ${stderr.trim()}` : "";
      settle(() => reject(new Error(`VantheaX exited with ${code ?? signal} before it was ready${detail}`)));
    });
  });
  return { client: create_client({ base_url: ready.url, token }), url: ready.url, close };
};
