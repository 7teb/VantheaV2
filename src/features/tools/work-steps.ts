import type { NoticeStep, ReasoningStep, SteerStep, ToolStep } from "../../../shared/chat.ts";

export type WorkStep = ToolStep | ReasoningStep | NoticeStep | SteerStep;

export const work_tools = (steps: WorkStep[]): ToolStep[] => steps.filter((step): step is ToolStep => step.kind === "tool");

const blank_thought = (step: ReasoningStep): boolean => step.text.trim() === "" && !step.status_line;

export const shown_step = (step: WorkStep): boolean => step.kind !== "reasoning" || !blank_thought(step);

export const timed_steps = (steps: WorkStep[]) => steps.filter((step): step is ToolStep | ReasoningStep => step.kind === "tool" || step.kind === "reasoning");

export const is_step_group = (steps: WorkStep[]): boolean => !(steps.length === 1 && steps[0]?.kind === "tool");

export const live_thought = (steps: WorkStep[]): ReasoningStep | null => {
  const last = steps.at(-1);
  return last?.kind === "reasoning" && last.ended_at === null ? last : null;
};

