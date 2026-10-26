import type { ReasoningStep, ToolStep } from "../../../shared/chat.ts";

export type WorkStep = ToolStep | ReasoningStep;

export const work_tools = (steps: WorkStep[]): ToolStep[] => steps.filter((step): step is ToolStep => step.kind === "tool");

const blank_thought = (step: ReasoningStep): boolean => step.text.trim() === "" && !step.status_line;

export const shown_step = (step: WorkStep): boolean => step.kind === "tool" || !blank_thought(step);

export const is_step_group = (steps: WorkStep[]): boolean => !(steps.length === 1 && steps[0]?.kind === "tool");

export const live_thought = (steps: WorkStep[]): ReasoningStep | null => {
  const last = steps.at(-1);
  return last?.kind === "reasoning" && last.ended_at === null ? last : null;
};

export const group_start = (steps: WorkStep[]): number | null => {
  const starts = steps.flatMap((step) => (step.started_at === null ? [] : [step.started_at]));
  return starts.length > 0 ? Math.min(...starts) : null;
};

export const group_span = (steps: WorkStep[]): number | null => {
  const start = group_start(steps);
  const ends = steps.flatMap((step) => (step.ended_at === null ? [] : [step.ended_at]));
  return start === null || ends.length === 0 ? null : Math.max(0, Math.max(...ends) - start);
};
