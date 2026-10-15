import type { ReasoningStep } from "../../../shared/chat.ts";
import type { Translate } from "../../i18n/translate.ts";
import { format_duration } from "../tools/tool-summary.ts";

export type ReasoningHead = { label: string; status: string | undefined; expandable: boolean; working: boolean };

const plain_label = (t: Translate, step: ReasoningStep, working: boolean): string => {
  if (working) {
    return t("chat.thinking");
  }
  if (step.ended_at === null) {
    return t("chat.thought");
  }
  return t("chat.thought_for", { time: format_duration(step.ended_at - step.started_at) });
};

export const reasoning_head = (t: Translate, step: ReasoningStep, live: boolean): ReasoningHead => {
  const working = live && step.ended_at === null;
  const status = working ? step.status_line : undefined;
  return {
    label: status || plain_label(t, step, working),
    status,
    expandable: step.text.trim().length > 0,
    working,
  };
};
