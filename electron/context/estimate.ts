import type { ContextUsage } from "../../shared/chat.ts";
import type { ModelEntry } from "../../shared/models.ts";
import type { RoundUsage } from "../model/types.ts";

export const estimate_tokens = (text: string): number => {
  const value = text ?? "";
  const non_ascii = Buffer.byteLength(value, "utf8") - value.length;
  return Math.ceil(value.length / 4 + non_ascii / 2);
};

export const cap_text = (text: string, max_tokens: number): string => {
  if (estimate_tokens(text) <= max_tokens) {
    return text;
  }
  let kept = text.slice(0, max_tokens * 4);
  while (kept.length > 2000 && estimate_tokens(kept) > max_tokens) {
    kept = kept.slice(0, Math.floor(kept.length * 0.85));
  }
  return `${kept}\n[truncated: ${text.length - kept.length} chars over the ${max_tokens}-token cap]`;
};

export const usage_from_round = (usage: RoundUsage, model: ModelEntry): ContextUsage => ({
  used: usage.prompt_tokens + usage.completion_tokens,
  limit: model.context_length,
});
