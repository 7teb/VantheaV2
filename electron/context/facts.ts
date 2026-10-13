import path from "node:path";
import type { Step, ToolStep } from "../../shared/chat.ts";
import { file_changes, type FileChange } from "../../shared/file-changes.ts";
import { path_key } from "../storage/paths.ts";

const recent_commands = 10;

const command_chars = 200;

const command_tools = new Set(["run_command", "start_background_task"]);

const change_line = (change: FileChange): string => {
  const counts = `+${change.added} -${change.removed}`;
  return `- ${change.path} (${change.created ? `created, ${counts}` : counts})`;
};

const raw_command = (step: ToolStep): string => {
  if (typeof step.args.command === "string") {
    return step.args.command;
  }
  return step.view?.kind === "command" || step.view?.kind === "background" ? step.view.command : "";
};

const command_text = (step: ToolStep): string => {
  const flat = raw_command(step).trim().replace(/\s+/g, " ");
  return flat.length > command_chars ? `${flat.slice(0, command_chars)} ...` : flat;
};

const command_status = (step: ToolStep): string => {
  const view = step.view;
  if (step.status === "done" && view?.kind === "command") {
    if (view.timed_out) {
      return "timed out";
    }
    return view.exit_code === null ? "no exit code" : `exit ${view.exit_code}`;
  }
  if (step.status === "done" && view?.kind === "background") {
    return `started as background task ${view.task_id}`;
  }
  return step.status;
};

export const harness_facts = (steps: Step[], written: string[], project_root: string): string => {
  const changes = file_changes(steps);
  const changed = new Set(changes.map((change) => path_key(path.resolve(project_root, change.path))));
  const elsewhere = written.filter((file) => !changed.has(path_key(file)));
  const commands = steps
    .filter((step): step is ToolStep => step.kind === "tool" && command_tools.has(step.name) && step.status !== "drafting" && step.status !== "queued")
    .slice(-recent_commands);
  const lines: string[] = [];
  if (changes.length) {
    lines.push("Files changed:", ...changes.map(change_line));
  }
  if (elsewhere.length) {
    lines.push("Also written in this chat by sub-agents or page checks:", ...elsewhere.map((file) => `- ${file}`));
  }
  if (commands.length) {
    lines.push("Last commands:", ...commands.map((step) => `- \`${command_text(step)}\`: ${command_status(step)}`));
  }
  return lines.length ? ["[Harness record, built by the app from its own tool log, not written by you.]", ...lines].join("\n") : "";
};
