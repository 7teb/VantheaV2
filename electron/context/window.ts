import type { ModelEntry } from "../../shared/models.ts";
import { reasoning_bound_to_prefix } from "../model/prompt-cache.ts";
import type { ApiMessage } from "../model/types.ts";
import { estimate_tokens } from "./estimate.ts";
import { drop_reasoning_after } from "./images.ts";

export const removed_output_stub = "[Tool output removed: the conversation did not fit into the model's context window.]";

export type RemovedOutput = { tool: string; call_id: string };

type ListedTokens = (output: RemovedOutput) => number;

const call_names = (messages: ApiMessage[]): Map<string, string> =>
  new Map(messages.flatMap((message) => (message.role === "assistant" ? (message.tool_calls ?? []).map((call): [string, string] => [call.id, call.function.name]) : [])));

export const drop_oldest_outputs = (messages: ApiMessage[], model: ModelEntry, excess: number, listed_tokens: ListedTokens = () => 0): RemovedOutput[] => {
  if (excess <= 0) {
    return [];
  }
  const names = call_names(messages);
  const stub_tokens = estimate_tokens(removed_output_stub);
  const removed: RemovedOutput[] = [];
  let left = excess;
  let first = -1;
  for (const [index, message] of messages.entries()) {
    if (left <= 0) {
      break;
    }
    if (message.role !== "tool") {
      continue;
    }
    const output: RemovedOutput = { tool: names.get(message.tool_call_id) ?? "unknown tool", call_id: message.tool_call_id };
    const saved = estimate_tokens(message.content) - stub_tokens - listed_tokens(output);
    if (saved <= 0) {
      continue;
    }
    message.content = removed_output_stub;
    left -= saved;
    removed.push(output);
    first = first < 0 ? index : first;
  }
  if (first >= 0 && reasoning_bound_to_prefix(model.id)) {
    drop_reasoning_after(messages, first);
  }
  return removed;
};

export const fit_window = (messages: ApiMessage[], model: ModelEntry, tokens: number, listed_tokens: ListedTokens = () => 0, fill = 1, scale = 1): RemovedOutput[] =>
  model.context_length > 0 ? drop_oldest_outputs(messages, model, Math.ceil((tokens - Math.floor(model.context_length * fill)) / scale), listed_tokens) : [];
