import fs from "node:fs/promises";
import type { ToolView } from "../../../shared/tool-view.ts";
import { invalidate_index } from "../../project/index.ts";
import { resolve_inside } from "../../project/scope.ts";
import type { OutputCollector } from "../../shell/output.ts";
import { run_shell } from "../../shell/run.ts";
import { read_number, read_string, require_string } from "../browser/common.ts";
import { failed, guarded } from "../fs/common.ts";
import { define_tool, ToolArgumentError, type ToolContext } from "../types.ts";
import { blocked_text, gate_command } from "./gate.ts";

type RunArgs = { command: string; cwd: string; timeout_ms: number };

export const default_timeout_ms = 30_000;

export const max_timeout_ms = 3_600_000;

const progress_interval_ms = 350;

const progress_tail_chars = 2000;

export const command_dir = async (project_root: string, cwd: string) => {
  const scoped = await resolve_inside(project_root, cwd || ".");
  if (!(await fs.stat(scoped.target)).isDirectory()) {
    throw new Error(`cwd ${scoped.relative} is not a folder`);
  }
  return scoped;
};

const progress_reporter = (ctx: ToolContext) => {
  let last = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let latest: OutputCollector | null = null;
  const send = () => {
    pending = null;
    last = Date.now();
    if (latest) {
      ctx.progress({ label: "", lines: latest.lines(), output_tail: latest.tail(progress_tail_chars) });
    }
  };
  return {
    update: (output: OutputCollector) => {
      latest = output;
      if (pending) {
        return;
      }
      const wait = progress_interval_ms - (Date.now() - last);
      if (wait <= 0) {
        send();
        return;
      }
      pending = setTimeout(send, wait);
    },
    stop: () => {
      if (pending) {
        clearTimeout(pending);
      }
      pending = null;
    },
  };
};

const command_view = (command: string, cwd: string, output: string, extra: Partial<Extract<ToolView, { kind: "command" }>> = {}): ToolView => ({
  kind: "command",
  command,
  cwd,
  exit_code: null,
  output,
  timed_out: false,
  duration_ms: 0,
  ...extra,
});

export const read_command = (raw: Record<string, unknown>): string => {
  const command = require_string(raw, "command").trim();
  if (!command) {
    throw new ToolArgumentError("command must not be blank");
  }
  return command;
};

const parse_run = (raw: Record<string, unknown>): RunArgs => {
  const timeout = read_number(raw, "timeout_ms") ?? default_timeout_ms;
  return {
    command: read_command(raw),
    cwd: read_string(raw, "cwd") ?? ".",
    timeout_ms: Math.min(max_timeout_ms, Math.max(1000, Math.round(timeout))),
  };
};

export const run_command_tool = define_tool<RunArgs>({
  spec: {
    name: "run_command",
    description:
      "Run a PowerShell command in the project folder and return its combined output and exit code. The string runs directly under powershell.exe -Command, so write PowerShell (';' to chain, $null instead of >nul) and do not wrap it in powershell, pwsh, cmd /c or bash. It runs headless and must exit on its own: open programs the user should operate in their own window with Start-Process, and use start_background_task for work that takes minutes.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string", description: "Project-relative working folder. Defaults to the project root." },
        timeout_ms: { type: "number", description: `Milliseconds before the command is killed. Default ${default_timeout_ms}, at most ${max_timeout_ms}.` },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  profiles: ["main", "worker"],
  parse: parse_run,
  run: (ctx, args) =>
    guarded(ctx, "run_command", async () => {
      const dir = await command_dir(ctx.project_root, args.cwd);
      const gate = await gate_command(ctx, args.command, dir.target, false);
      if (gate.kind === "block") {
        const text = blocked_text(gate.reason);
        return { ...failed(text), view: command_view(args.command, dir.relative, text) };
      }
      if (gate.kind === "denied") {
        return { status: "denied", text: gate.text, view: null };
      }
      const reporter = progress_reporter(ctx);
      ctx.progress({ label: "", lines: 0, output_tail: null });
      const outcome = await run_shell({
        command: args.command,
        cwd: dir.target,
        timeout_ms: args.timeout_ms,
        signal: ctx.signal,
        on_output: reporter.update,
      }).finally(() => {
        reporter.stop();
        invalidate_index(ctx.project_root);
      });
      const status = outcome.timed_out ? "timed out" : `exit code ${outcome.exit_code ?? "unknown"}`;
      const seconds = (outcome.duration_ms / 1000).toFixed(1);
      return {
        status: outcome.exit_code === 0 && !outcome.timed_out ? "done" : "failed",
        text: `${status} after ${seconds} s\n${outcome.output || "(no output)"}`,
        view: command_view(args.command, dir.relative, outcome.output, {
          exit_code: outcome.exit_code,
          timed_out: outcome.timed_out,
          duration_ms: outcome.duration_ms,
        }),
      };
    }),
});
