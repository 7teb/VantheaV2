import fs from "node:fs/promises";
import { shell_labels, shell_run_tools, type ShellKind } from "../../../shared/shell.ts";
import type { ToolView } from "../../../shared/tool-view.ts";
import { invalidate_index } from "../../project/index.ts";
import { resolve_inside } from "../../project/scope.ts";
import { estimate_tokens, result_cap_tokens } from "../../context/estimate.ts";
import type { OutputView } from "../../shell/output.ts";
import { run_shell } from "../../shell/run.ts";
import { read_number, read_string, require_string } from "../browser/common.ts";
import { failed, guarded } from "../fs/common.ts";
import { define_tool, ToolArgumentError, type JsonSchema, type ToolContext, type ToolResult } from "../types.ts";
import { blocked_text, gate_command } from "./gate.ts";
import { can_hand_off, moved_result, offer_handoff, withdraw_handoff } from "./handoff.ts";

export type RunArgs = { command: string; cwd: string; timeout_ms: number };

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

const progress_reporter = (ctx: ToolContext, can_background: boolean) => {
  const marker = can_background ? { can_background } : {};
  let last = Date.now();
  let pending: ReturnType<typeof setTimeout> | null = null;
  let latest: OutputView | null = null;
  ctx.progress({ label: "", lines: 0, output_tail: null, ...marker });
  const send = () => {
    pending = null;
    last = Date.now();
    if (latest) {
      ctx.progress({ label: "", lines: latest.lines(), output_tail: latest.tail(progress_tail_chars), ...marker });
    }
  };
  return {
    update: (output: OutputView) => {
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

export const command_view = (shell: ShellKind, command: string, cwd: string, output: string, extra: Partial<Extract<ToolView, { kind: "command" }>> = {}): ToolView => ({
  kind: "command",
  shell: shell_labels[shell],
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

export const parse_run = (raw: Record<string, unknown>): RunArgs => {
  const timeout = read_number(raw, "timeout_ms") ?? default_timeout_ms;
  return {
    command: read_command(raw),
    cwd: read_string(raw, "cwd") ?? ".",
    timeout_ms: Math.min(max_timeout_ms, Math.max(1000, Math.round(timeout))),
  };
};

export const run_parameters: JsonSchema = {
  type: "object",
  properties: {
    command: { type: "string" },
    cwd: { type: "string", description: "Project-relative working folder. Defaults to the project root." },
    timeout_ms: { type: "number", description: `Milliseconds before the command is killed. Default ${default_timeout_ms}, at most ${max_timeout_ms}.` },
  },
  required: ["command"],
  additionalProperties: false,
};

const timeout_hint = (ctx: ToolContext, shell: ShellKind): string =>
  `; for longer work raise timeout_ms (at most ${max_timeout_ms})${ctx.profile === "main" ? ` or use start_background_task${shell === "bash" ? " with shell bash" : ""}` : ""}`;

export const run_in_shell = (ctx: ToolContext, args: RunArgs, shell: ShellKind): Promise<ToolResult> =>
  guarded(ctx, shell_run_tools[shell], async () => {
    const dir = await command_dir(ctx.project_root, args.cwd);
    const gate = await gate_command(ctx, args.command, dir.target, false, shell);
    if (gate.kind === "block") {
      return { ...failed(blocked_text(gate.reason)), view: command_view(shell, args.command, dir.relative, "") };
    }
    if (gate.kind === "denied") {
      return { status: "denied", text: gate.text, view: command_view(shell, args.command, dir.relative, gate.output) };
    }
    const handoff = can_hand_off(ctx);
    const reporter = progress_reporter(ctx, handoff);
    const outcome = await run_shell({
      command: args.command,
      cwd: dir.target,
      timeout_ms: args.timeout_ms,
      signal: ctx.signal,
      on_output: reporter.update,
      on_detachable: handoff ? (detach) => offer_handoff(ctx, { command: args.command, cwd: dir.relative, shell }, detach) : undefined,
      shell,
    }).finally(() => {
      reporter.stop();
      if (handoff) {
        withdraw_handoff(ctx);
      }
      invalidate_index(ctx.project_root);
    });
    if (outcome.kind === "detached") {
      return moved_result(args.command, shell, gate.note, outcome);
    }
    const status = outcome.timed_out ? "timed out" : `exit code ${outcome.exit_code ?? "unknown"}`;
    const seconds = (outcome.duration_ms / 1000).toFixed(1);
    const lead = `${gate.note ? `${gate.note}\n` : ""}${status} after ${seconds} s${outcome.timed_out ? timeout_hint(ctx, shell) : ""}\n`;
    const output = outcome.output.text(result_cap_tokens - estimate_tokens(lead));
    return {
      status: outcome.exit_code === 0 && !outcome.timed_out ? "done" : "failed",
      text: `${lead}${output || "(no output)"}`,
      view: command_view(shell, args.command, dir.relative, output, {
        exit_code: outcome.exit_code,
        timed_out: outcome.timed_out,
        duration_ms: outcome.duration_ms,
      }),
    };
  });

export const run_command_tool = define_tool<RunArgs>({
  spec: {
    name: shell_run_tools.powershell,
    description:
      `Run a PowerShell command in the project folder and return its combined output and exit code. The string runs directly under powershell.exe -Command, so write PowerShell (';' to chain, $null instead of >nul) and do not wrap it in powershell, pwsh, cmd /c or bash. stderr is already captured with stdout, so do not add 2>&1: Windows PowerShell turns redirected stderr of native programs into error records and reports a successful program as failed. It runs headless and must exit on its own: open programs the user should operate in their own window with Start-Process. The default timeout is ${default_timeout_ms / 1000} s; for builds, tests or installs set timeout_ms up front.`,
    parameters: run_parameters,
  },
  profiles: ["main", "plan", "worker"],
  parse: parse_run,
  run: (ctx, args) => run_in_shell(ctx, args, "powershell"),
});
