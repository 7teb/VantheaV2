import type { ToolStep } from "../../../shared/chat.ts";
import type { WorkflowSummary } from "../../../shared/workflow.ts";
import type { Translate } from "../../i18n/translate.ts";
import { is_reviewing } from "./review-phase.ts";
import { tool_label } from "./tool-meta.ts";
import { group_current, group_label } from "./tool-summary.ts";
import { live_thought, work_tools, type WorkStep } from "./work-steps.ts";
import { workflow_label } from "./workflow-model.ts";

export type GroupHead =
  | { kind: "done"; key: string; label: string; denied: number }
  | { kind: "thinking"; key: string; label: string }
  | { kind: "tool"; key: string; label: string }
  | { kind: "workflow"; key: string; label: string; started_at: number }
  | { kind: "review"; key: string; step: ToolStep };

const count_status = (tools: ToolStep[], status: ToolStep["status"]) => tools.filter((step) => step.status === status).length;

const counted = (step: ToolStep) => step.status === "done" || (step.status === "failed" && step.view?.kind === "command");

const settled_label = (t: Translate, tools: ToolStep[]): string => {
  if (tools.length === 1 && tools[0].status !== "done") {
    return tool_label(t, tools[0]);
  }
  if (!tools.some((step) => step.status === "done" || step.status === "failed" || step.status === "denied")) {
    return group_label(t, tools);
  }
  const shown = tools.filter(counted);
  return shown.length > 0 ? group_label(t, shown) : tool_label(t, tools[tools.length - 1]);
};

const settled_head = (t: Translate, tools: ToolStep[]): GroupHead => {
  const label = settled_label(t, tools);
  const denied = tools.length === 1 && tools[0].status === "denied" ? 0 : count_status(tools, "denied");
  return { kind: "done", key: `done:${label}:${denied}`, label, denied };
};

export const open_head = (t: Translate, steps: WorkStep[]): GroupHead | null => {
  const tools = work_tools(steps);
  return tools.some((step) => step.status === "done") ? settled_head(t, tools) : null;
};

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
    const active = tools.filter((step) => step.status === "running" || step.status === "awaiting_approval").length;
    const label = active > 1 ? t("tools.running_alongside", { x: tool_label(t, current), n: active - 1 }) : tool_label(t, current);
    return { kind: "tool", key: `tool:${label}`, label };
  }
  if (live) {
    const label = workflow_label(t, live.name, live.status);
    return { kind: "workflow", key: `workflow:${label}`, label, started_at: Date.parse(live.started_at) };
  }
  return settled_head(t, tools);
};
