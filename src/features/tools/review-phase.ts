import type { ToolStep } from "../../../shared/chat.ts";
import type { Translate } from "../../i18n/translate.ts";
import { tool_label, tool_meta } from "./tool-meta.ts";
import { format_elapsed } from "./tool-summary.ts";

export const is_reviewing = (step: ToolStep) => step.status === "running" && step.progress?.phase === "review";

export const is_command_step = (step: ToolStep) => tool_meta(step).category === "commands";

export const reviewing_label = (t: Translate, step: ToolStep, now: number): string => {
  if (!is_command_step(step)) {
    return tool_label(t, step);
  }
  const elapsed = format_elapsed(now - (step.started_at ?? now));
  return elapsed === null ? t("tool_label.running_command") : t("tool_label.running_command_for", { x: elapsed });
};
