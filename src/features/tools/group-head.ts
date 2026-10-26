import type { ToolStep } from "../../../shared/chat.ts";
import type { Translate } from "../../i18n/translate.ts";
import { is_reviewing } from "./review-phase.ts";
import { tool_label } from "./tool-meta.ts";
import { group_current, group_label } from "./tool-summary.ts";
import { live_thought, work_tools, type WorkStep } from "./work-steps.ts";

export type GroupHead =
  | { kind: "done"; key: string; label: string }
  | { kind: "thinking"; key: string; label: string }
  | { kind: "tool"; key: string; label: string }
  | { kind: "review"; key: string; step: ToolStep };

export const group_head = (t: Translate, steps: WorkStep[], streaming: boolean, pending = false): GroupHead => {
  const tools = work_tools(steps);
  const thought = streaming ? live_thought(steps) : null;
  if (pending && !thought) {
    const label = t("chat.thinking");
    return { kind: "thinking", key: `thinking:${label}`, label };
  }
  if (thought) {
    const label = thought.status_line || t("chat.thinking");
    return { kind: "thinking", key: `thinking:${label}`, label };
  }
  const current = streaming ? group_current(tools) : null;
  if (current && is_reviewing(current)) {
    return { kind: "review", key: `review:${current.id}`, step: current };
  }
  if (current) {
    const label = tool_label(t, current);
    return { kind: "tool", key: `tool:${label}`, label };
  }
  const label = group_label(t, tools);
  return { kind: "done", key: `done:${label}`, label };
};
