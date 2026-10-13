import { compact_fraction } from "../../shared/chat.ts";
import type { ModelEntry } from "../../shared/models.ts";
import { reasoning_bound_to_prefix } from "../model/prompt-cache.ts";
import type { ApiMessage } from "../model/types.ts";
import { resume_text, type CompactAudience } from "./compact-text.ts";
import { drop_reasoning_after } from "./images.ts";
import { estimate_messages } from "./usage.ts";

const regrow_fraction = 0.1;

const recent_rounds = 10;

const recent_fraction = 0.3;

export const compact_threshold = (model: ModelEntry): number => model.compact_at ?? compact_fraction;

export const compaction_due = (tokens: number, floor: number, model: ModelEntry): boolean =>
  model.context_length > 0 && tokens > model.context_length * compact_threshold(model) && tokens >= floor + model.context_length * regrow_fraction;

export const compaction_floor = (tokens: number, model: ModelEntry): number => (tokens > model.context_length * compact_threshold(model) ? tokens : 0);

export const is_user_voice = (message: ApiMessage): boolean => message.role === "user" && Boolean(message.instruction || message.steer);

const is_compaction_part = (message: ApiMessage): boolean => message.role === "user" && Boolean(message.compaction);

export type WindowStep = "more" | "round" | "full";

export const window_meter = (model: ModelEntry): ((message: ApiMessage) => WindowStep) => {
  const budget = model.context_length * recent_fraction;
  let tokens = 0;
  let rounds = 0;
  let full = false;
  return (message) => {
    if (full) {
      return "full";
    }
    tokens += is_user_voice(message) ? 0 : estimate_messages([message]);
    if (message.role !== "assistant") {
      return "more";
    }
    if (rounds > 0 && tokens > budget) {
      full = true;
      return "full";
    }
    rounds += 1;
    full = rounds === recent_rounds;
    return "round";
  };
};

const window_start = (history: ApiMessage[], model: ModelEntry): number => {
  const take = window_meter(model);
  let start = history.length;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const step = take(history[index]);
    if (step === "full") {
      break;
    }
    if (step === "round") {
      start = index;
    }
  }
  return start;
};

export type CompactedInput = { note: string; facts: string; audience: CompactAudience; history: ApiMessage[]; model: ModelEntry };

export const compacted_messages = ({ note, facts, audience, history, model }: CompactedInput): ApiMessage[] => {
  const kept = history.filter((message) => !is_compaction_part(message));
  const start = window_start(kept, model);
  const out: ApiMessage[] = [
    { role: "user", compaction: true, content: `${resume_text(audience)}\n\n${note}` },
    ...kept.slice(0, start).filter(is_user_voice),
    ...kept.slice(start),
    ...(facts ? [{ role: "user", compaction: true, content: facts } as const] : []),
  ];
  if (reasoning_bound_to_prefix(model.id)) {
    drop_reasoning_after(out, 0);
  }
  return out;
};
