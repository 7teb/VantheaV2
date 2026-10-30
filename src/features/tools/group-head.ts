import type { ToolStep } from "../../../shared/chat.ts";
import type { WorkflowSummary } from "../../../shared/workflow.ts";
import type { Translate } from "../../i18n/translate.ts";
import { is_reviewing } from "./review-phase.ts";
import { tool_label } from "./tool-meta.ts";
import { group_current, group_label } from "./tool-summary.ts";
import { live_thought, work_tools, type WorkStep } from "./work-steps.ts";
import { workflow_label } from "./workflow-model.ts";

export type GroupHead =
  | { kind: "done"; key: string; label: string }
  | { kind: "thinking"; key: string; label: string }
  | { kind: "tool"; key: string; label: string }
  | { kind: "workflow"; key: string; label: string; started_at: number }
  | { kind: "review"; key: string; step: ToolStep };

export const group_head = (t: Translate, steps: WorkStep[], streaming: boolean, pending = false, live: WorkflowSummary | null = null): GroupHead => {
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
  if (live) {
    const label = workflow_label(t, live.name, live.status);
    return { kind: "workflow", key: `workflow:${label}`, label, started_at: Date.parse(live.started_at) };
  }
  const label = group_label(t, tools);
  return { kind: "done", key: `done:${label}`, label };
};
