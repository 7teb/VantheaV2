import type { ReasoningStep } from "../../../shared/chat.ts";
import type { Translate } from "../../i18n/translate.ts";
import { format_duration } from "../tools/tool-summary.ts";

export type ReasoningHead = { label: string; meta: string | null; status: string | undefined; expandable: boolean; working: boolean };

const description_cap = 120;

const heading_line = /^#{1,6}\s+(.+?)(?:\s+#+)?$/;

const bold_line = /^(\*\*|__)(.+)\1:?$/;

const fence_line = /^(```|~~~)/;

const line_title = (line: string): string | null => {
  const heading = heading_line.exec(line);
  if (heading) {
    return heading[1];
  }
  const bold = bold_line.exec(line);
  if (!bold) {
    return null;
  }
  const [, marker, inner] = bold;
  return inner.includes(marker) ? null : inner;
};

const capped = (text: string): string => (text.length > description_cap ? `${text.slice(0, description_cap - 1).trimEnd()}…` : text);

const last_title = (text: string): string | null => {
  let fenced = false;
  let found: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (fence_line.test(line)) {
      fenced = !fenced;
      continue;
    }
    const title = fenced ? null : line_title(line)?.replaceAll("**", "").replaceAll("`", "").trim();
    if (title) {
      found = title;
    }
  }
  return found;
};

export const thought_description = (step: ReasoningStep): string | null => {
  const status = step.status_line?.trim();
  const title = status || last_title(step.text);
  return title ? capped(title) : null;
};

export const reasoning_head = (t: Translate, step: ReasoningStep, live: boolean): ReasoningHead => {
  const working = live && step.ended_at === null;
  const status = working ? step.status_line : undefined;
  const expandable = step.text.trim().length > 0;
  if (working) {
    return { label: status || t("chat.thinking"), meta: null, status, expandable, working };
  }
  const description = thought_description(step);
  const duration = step.ended_at === null ? null : format_duration(step.ended_at - step.started_at);
  if (description) {
    return { label: description, meta: duration, status, expandable, working };
  }
  return { label: duration === null ? t("chat.thought") : t("chat.thought_for", { time: duration }), meta: null, status, expandable, working };
};
