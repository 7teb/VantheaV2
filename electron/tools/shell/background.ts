import type { BackgroundTask } from "../../../shared/ipc/work.ts";
import { shell_kinds, shell_labels, type ShellKind } from "../../../shared/shell.ts";
import { cancel_background, find_background, mark_result_read, start_background } from "../../background/manager.ts";
import { estimate_tokens, result_cap_tokens } from "../../context/estimate.ts";
import { git_bash_path } from "../../shell/git-bash.ts";
import type { OutputView } from "../../shell/output.ts";
import { read_string, require_string } from "../browser/common.ts";
import { failed, guarded } from "../fs/common.ts";
import { define_tool, ToolArgumentError, type ToolResult } from "../types.ts";
import { blocked_text, gate_command } from "./gate.ts";
import { command_dir, command_view, read_command } from "./run-command.ts";
import { background_view, task_name } from "./task-view.ts";

type StartArgs = { name: string; command: string; cwd: string; shell: ShellKind };

const described = (task: BackgroundTask, output: OutputView): ToolResult => {
  const exit = task.exit_code === null ? "" : `, exit code ${task.exit_code}`;
  const ended = task.ended_at ? `, ended ${task.ended_at}` : "";
  const lead = `Background task ${task.id} (${task.name}): ${task.status}${exit}, started ${task.started_at}${ended}\nShell: ${shell_labels[task.shell]}\nCommand: ${task.command}\n`;
  const shown = output.text(result_cap_tokens - estimate_tokens(`${lead}Output:\n`));
  return { status: "done", text: `${lead}${shown ? `Output:\n${shown}` : "No output yet."}`, view: background_view(task, shown) };
};

const read_shell = (raw: Record<string, unknown>): ShellKind => {
  const value = read_string(raw, "shell") ?? "powershell";
  const shell = shell_kinds.find((kind) => kind === value);
  if (!shell) {
    throw new ToolArgumentError(`shell must be powershell or bash, not ${value}`);
  }
  if (shell === "bash" && git_bash_path() === null) {
    throw new ToolArgumentError("shell bash needs Git Bash, which was not found on this PC; use shell powershell");
  }
  return shell;
};

const parse_start = (raw: Record<string, unknown>): StartArgs => {
  const name = task_name(require_string(raw, "name"));
  if (!name) {
    throw new ToolArgumentError("name must not be blank");
  }
  return { name, command: read_command(raw), cwd: read_string(raw, "cwd") ?? ".", shell: read_shell(raw) };
};

export const start_background_task_tool = define_tool<StartArgs>({
  spec: {
    name: "start_background_task",
    description:
      "Start a long, non-interactive command in the background with PowerShell (default) or Git Bash and return its task id at once. Use it for work that takes minutes (long builds, data processing, scans, training) and keep working meanwhile. Its status, exit code and output arrive automatically when it ends; get_background_task reads them earlier.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short name shown to the user." },
        command: { type: "string", description: "Command in the syntax of the chosen shell that needs no input and exits on its own." },
        cwd: { type: "string", description: "Project-relative working folder. Defaults to the project root." },
        shell: {
          type: "string",
          enum: ["powershell", "bash"],
          description: "powershell (default) runs the command like run_command; bash runs it with Git Bash like run_bash and is only available when run_bash is offered.",
        },
      },
      required: ["name", "command"],
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  parse: parse_start,
  run: (ctx, args) =>
    guarded(ctx, "start_background_task", async () => {
      const dir = await command_dir(ctx.project_root, args.cwd);
      const gate = await gate_command(ctx, args.command, dir.target, true, args.shell);
      if (gate.kind === "block") {
        return { ...failed(blocked_text(gate.reason)), view: command_view(args.shell, args.command, dir.relative, "") };
      }
      if (gate.kind === "denied") {
        return { status: "denied", text: gate.text, view: command_view(args.shell, args.command, dir.relative, gate.output) };
      }
      const task = await start_background({
        chat_id: ctx.chat_id,
        turn_id: ctx.turn_id,
        project_root: ctx.project_root,
        cwd: dir.relative,
        name: args.name,
        command: args.command,
        shell: args.shell,
      });
      return {
        status: "done",
        text: `${gate.note ? `${gate.note}\n` : ""}Started background task ${task.id} (${task.name}). It keeps running after this turn; its result arrives automatically when it ends.`,
        view: background_view(task, task.output_tail),
      };
    }),
});

const id_parameters = {
  type: "object" as const,
  properties: { id: { type: "string", description: "Task id or a unique leading part of it." } },
  required: ["id"],
  additionalProperties: false,
};

export const get_background_task_tool = define_tool<{ id: string }>({
  spec: {
    name: "get_background_task",
    description: `Read the status, exit code and output of a background task in this chat. Output over the ${result_cap_tokens}-token cap per tool result keeps its start and end and says how many characters are omitted.`,
    parameters: id_parameters,
  },
  profiles: ["main", "plan"],
  parse: (raw) => ({ id: require_string(raw, "id").trim() }),
  run: (ctx, args) =>
    guarded(ctx, "get_background_task", async () => {
      const found = find_background(args.id, ctx.chat_id);
      if (found.task === null) {
        return failed(found.error);
      }
      if (found.task.status !== "running") {
        mark_result_read(found.task.id);
      }
      return described(found.task, found.output);
    }),
});

export const cancel_background_task_tool = define_tool<{ id: string }>({
  spec: {
    name: "cancel_background_task",
    description: "Stop a running background task in this chat and its child processes.",
    parameters: id_parameters,
  },
  profiles: ["main"],
  parse: (raw) => ({ id: require_string(raw, "id").trim() }),
  run: (ctx, args) =>
    guarded(ctx, "cancel_background_task", async () => {
      const found = find_background(args.id, ctx.chat_id);
      if (found.task === null) {
        return failed(found.error);
      }
      if (found.task.status !== "running") {
        return { status: "done", text: `Background task ${found.task.id} already ended (${found.task.status}); nothing was stopped.`, view: background_view(found.task, found.task.output_tail) };
      }
      return described(cancel_background(found.task.id), found.output);
    }),
});
