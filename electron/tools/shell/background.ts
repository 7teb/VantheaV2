import type { BackgroundTask } from "../../../shared/ipc/work.ts";
import type { ToolView } from "../../../shared/tool-view.ts";
import { cancel_background, find_background, start_background } from "../../background/manager.ts";
import { read_string, require_string } from "../browser/common.ts";
import { failed, guarded } from "../fs/common.ts";
import { define_tool, ToolArgumentError } from "../types.ts";
import { blocked_text, gate_command } from "./gate.ts";
import { command_dir, read_command } from "./run-command.ts";

type StartArgs = { name: string; command: string; cwd: string };

const model_tail_chars = 8000;

const background_view = (task: BackgroundTask): ToolView => ({
  kind: "background",
  task_id: task.id,
  command: task.command,
  status: task.status,
  output_tail: task.output_tail,
});

const describe = (task: BackgroundTask) => {
  const exit = task.exit_code === null ? "" : `, exit code ${task.exit_code}`;
  const ended = task.ended_at ? `, ended ${task.ended_at}` : "";
  const tail = task.output_tail.slice(-model_tail_chars);
  return [`Background task ${task.id} (${task.name}): ${task.status}${exit}, started ${task.started_at}${ended}`, `Command: ${task.command}`, tail ? `Output tail:\n${tail}` : "No output yet."].join("\n");
};

const parse_start = (raw: Record<string, unknown>): StartArgs => {
  const name = require_string(raw, "name").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) {
    throw new ToolArgumentError("name must not be blank");
  }
  return { name, command: read_command(raw), cwd: read_string(raw, "cwd") ?? "." };
};

export const start_background_task_tool = define_tool<StartArgs>({
  spec: {
    name: "start_background_task",
    description:
      "Start a long, non-interactive PowerShell command in the background and return its task id at once. Use it for work that takes minutes (long builds, data processing, scans, training) and keep working meanwhile. Its status, exit code and output arrive automatically when it ends; get_background_task reads them earlier.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short name shown to the user." },
        command: { type: "string", description: "PowerShell command that needs no input and exits on its own." },
        cwd: { type: "string", description: "Project-relative working folder. Defaults to the project root." },
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
      const gate = await gate_command(ctx, args.command, dir.target, true);
      if (gate.kind === "block") {
        return failed(blocked_text(gate.reason));
      }
      if (gate.kind === "denied") {
        return { status: "denied", text: gate.text, view: null };
      }
      const task = await start_background({
        chat_id: ctx.chat_id,
        turn_id: ctx.turn_id,
        project_root: ctx.project_root,
        cwd: dir.relative,
        name: args.name,
        command: args.command,
      });
      return {
        status: "done",
        text: `Started background task ${task.id} (${task.name}). It keeps running after this turn; its result arrives automatically when it ends.`,
        view: background_view(task),
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
    description: "Read the status, exit code and output tail of a background task in this chat.",
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
      return { status: "done", text: describe(found.task), view: background_view(found.task) };
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
        return { status: "done", text: `Background task ${found.task.id} already ended (${found.task.status}); nothing was stopped.`, view: background_view(found.task) };
      }
      const task = cancel_background(found.task.id);
      return { status: "done", text: describe(task), view: background_view(task) };
    }),
});
