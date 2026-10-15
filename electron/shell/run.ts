import type { ChildProcess } from "node:child_process";
import { shell_labels, type ShellKind } from "../../shared/shell.ts";
import { output_collector, type OutputCollector, type OutputView } from "./output.ts";
import { exit_grace_ms, kill_tree, shell_exit, shell_spawners, signal_note, type ShellSpawner } from "./process.ts";

export type DetachedShell = { child: ChildProcess; output: OutputCollector; started_at: number };

export type ShellDetach = (task_id: string) => DetachedShell | null;

export type ShellRun = {
  command: string;
  cwd: string;
  timeout_ms: number;
  signal: AbortSignal;
  on_output: (output: OutputView) => void;
  on_detachable?: (detach: ShellDetach) => void;
  shell?: ShellKind;
};

export type ShellOutcome =
  | { kind: "exited"; exit_code: number | null; output: OutputView; timed_out: boolean; duration_ms: number }
  | { kind: "detached"; task_id: string; output: OutputView; duration_ms: number };

export const run_shell = (run: ShellRun, spawner: ShellSpawner = shell_spawners[run.shell ?? "powershell"]): Promise<ShellOutcome> =>
  new Promise((resolve, reject) => {
    if (run.signal.aborted) {
      reject(run.signal.reason);
      return;
    }
    const shell = run.shell ?? "powershell";
    const started = Date.now();
    const output = output_collector();
    const child = spawner(run.command, run.cwd);
    let settled = false;
    let exited = false;
    let exit_code: number | null = null;
    let exit_signal: string | null = null;
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
      const exit = shell_exit(shell, exit_code, exit_signal);
      if (exit.signal && !timed_out) {
        output.append(`\n${signal_note(exit.signal)}`);
      }
      resolve({ kind: "exited", exit_code: exit.exit_code, output, timed_out, duration_ms: Date.now() - started });
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
    const on_error = (error: Error) => {
      console.warn(`[shell] running ${run.command.slice(0, 200)} in ${run.cwd} failed: ${error.message}`);
      output.append(`\n[failed to start ${shell_labels[shell]}: ${error.message}]`);
      finish(false);
    };
    const on_exit = (code: number | null, signal: NodeJS.Signals | null) => {
      exited = true;
      exit_code = code;
      exit_signal = signal;
      grace = setTimeout(() => finish(false), exit_grace_ms);
    };
    const on_close = (code: number | null, signal: NodeJS.Signals | null) => {
      exit_code = code ?? exit_code;
      exit_signal = signal ?? exit_signal;
      finish(false);
    };
    const detach: ShellDetach = (task_id) => {
      if (settled || exited) {
        return null;
      }
      cleanup();
      child.stdout?.off("data", on_data);
      child.stderr?.off("data", on_data);
      child.off("error", on_error);
      child.off("exit", on_exit);
      child.off("close", on_close);
      resolve({ kind: "detached", task_id, output, duration_ms: Date.now() - started });
      return { child, output, started_at: started };
    };
    run.signal.addEventListener("abort", on_abort, { once: true });
    child.stdout?.on("data", on_data);
    child.stderr?.on("data", on_data);
    child.once("error", on_error);
    child.once("exit", on_exit);
    child.once("close", on_close);
    run.on_detachable?.(detach);
  });
