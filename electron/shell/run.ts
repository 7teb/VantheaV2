import type { ChildProcess } from "node:child_process";
import { output_collector, type OutputCollector } from "./output.ts";
import { kill_tree, spawn_powershell } from "./process.ts";

export type ShellSpawner = (command: string, cwd: string) => ChildProcess;

export type ShellRun = {
  command: string;
  cwd: string;
  timeout_ms: number;
  signal: AbortSignal;
  on_output: (output: OutputCollector) => void;
};

export type ShellOutcome = { exit_code: number | null; output: string; lines: number; timed_out: boolean; duration_ms: number };

const output_head_chars = 8000;

const output_tail_chars = 24000;

const exit_grace_ms = 2000;

export const run_shell = (run: ShellRun, spawner: ShellSpawner = spawn_powershell): Promise<ShellOutcome> =>
  new Promise((resolve, reject) => {
    if (run.signal.aborted) {
      reject(run.signal.reason);
      return;
    }
    const started = Date.now();
    const output = output_collector(output_head_chars, output_tail_chars);
    const child = spawner(run.command, run.cwd);
    let settled = false;
    let exit_code: number | null = null;
    let grace: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      if (grace) {
        clearTimeout(grace);
      }
      run.signal.removeEventListener("abort", on_abort);
    };
    const finish = (timed_out: boolean) => {
      if (settled) {
        return;
      }
      cleanup();
      resolve({ exit_code, output: output.text(), lines: output.lines(), timed_out, duration_ms: Date.now() - started });
    };
    const on_abort = () => {
      if (settled) {
        return;
      }
      cleanup();
      kill_tree(child.pid);
      reject(run.signal.reason);
    };
    const timer = setTimeout(() => {
      kill_tree(child.pid);
      output.append(`\n[command stopped after the ${Math.round(run.timeout_ms / 1000)} s timeout]`);
      finish(true);
    }, run.timeout_ms);
    const on_data = (chunk: string) => {
      if (settled) {
        return;
      }
      output.append(chunk);
      run.on_output(output);
    };
    run.signal.addEventListener("abort", on_abort, { once: true });
    child.stdout?.on("data", on_data);
    child.stderr?.on("data", on_data);
    child.once("error", (error) => {
      console.warn(`[shell] running ${run.command.slice(0, 200)} in ${run.cwd} failed: ${error.message}`);
      output.append(`\n[failed to start powershell.exe: ${error.message}]`);
      finish(false);
    });
    child.once("exit", (code) => {
      exit_code = code;
      grace = setTimeout(() => finish(false), exit_grace_ms);
    });
    child.once("close", (code) => {
      exit_code = code ?? exit_code;
      finish(false);
    });
  });
