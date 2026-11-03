import type { ToolStep } from "../../../shared/chat.ts";
import type { HookRun } from "../../../shared/hook-notes.ts";
import type { MessageKey } from "../../i18n/translate.ts";

export const step_hooks = (step: ToolStep): HookRun[] => step.hooks ?? [];

export const hook_blocked = (step: ToolStep): boolean =>
  step.status === "denied" && step_hooks(step).some((run) => run.event === "PreToolUse" && run.status === "blocked");

export const run_lead = (run: HookRun): MessageKey => {
  if (run.status === "error") {
    return "hooks.run_error";
  }
  if (run.status === "context") {
    return "hooks.run_context";
  }
  switch (run.event) {
    case "PreToolUse":
      return "hooks.run_blocked_call";
    case "UserPromptSubmit":
      return "hooks.run_blocked_message";
    case "Stop":
    case "SubagentStop":
      return "hooks.run_continue";
    case "SubagentStart":
      return "hooks.run_output";
    default:
      return "hooks.run_context";
  }
};

export type RunEmpty = "reason" | "output" | null;

export const run_empty = (run: HookRun): RunEmpty => {
  if (run.text.trim()) {
    return null;
  }
  if (run.status === "blocked") {
    return "reason";
  }
  return run.failure === "timeout" || run.failure === "start" ? null : "output";
};
