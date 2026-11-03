import type { ToolStep } from "../../../shared/chat.ts";
import type { HookAction } from "../../../shared/hooks.ts";
import type { DiffLine } from "../../../shared/tool-view.ts";

const context_line = (text: string, old_line: number, new_line: number): DiffLine => ({ kind: "context", text, old_line, new_line });

export const command_change = (before: string, after: string): DiffLine[] => {
  const old_lines = before.split("\n");
  const new_lines = after.split("\n");
  let head = 0;
  while (head < old_lines.length && head < new_lines.length && old_lines[head] === new_lines[head]) {
    head += 1;
  }
  let tail = 0;
  while (tail < old_lines.length - head && tail < new_lines.length - head && old_lines[old_lines.length - 1 - tail] === new_lines[new_lines.length - 1 - tail]) {
    tail += 1;
  }
  const old_end = old_lines.length - tail;
  const new_end = new_lines.length - tail;
  return [
    ...old_lines.slice(0, head).map((text, at) => context_line(text, at + 1, at + 1)),
    ...old_lines.slice(head, old_end).map((text, at): DiffLine => ({ kind: "remove", text, old_line: head + at + 1, new_line: null })),
    ...new_lines.slice(head, new_end).map((text, at): DiffLine => ({ kind: "add", text, old_line: null, new_line: head + at + 1 })),
    ...old_lines.slice(old_end).map((text, at) => context_line(text, old_end + at + 1, new_end + at + 1)),
  ];
};

const toggle_only = (args: Record<string, unknown>): boolean =>
  typeof args.enabled === "boolean" && Object.keys(args).every((key) => key === "id" || key === "scope" || key === "enabled");

export const hook_action = (step: ToolStep): HookAction | "list" => {
  if (step.view?.kind === "hooks") {
    return step.view.action;
  }
  if (step.approval?.kind === "hook") {
    return step.approval.action;
  }
  if (step.name === "list_hooks") {
    return "list";
  }
  if (step.name === "delete_hook") {
    return "delete";
  }
  if (typeof step.args.id !== "string" || !step.args.id.trim()) {
    return "create";
  }
  if (toggle_only(step.args)) {
    return step.args.enabled ? "enable" : "disable";
  }
  return "change";
};
