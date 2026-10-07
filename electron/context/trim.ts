import type { ModelEntry } from "../../shared/models.ts";
import type { ApiMessage } from "../model/types.ts";
import { estimate_tokens } from "./estimate.ts";
import { estimate_messages } from "./usage.ts";

export const trimmed_stub = "[earlier tool output trimmed to save context]";

const trim_fraction = 0.9;

const min_trimmable_tokens = 200;

export const trim_tool_messages = (messages: ApiMessage[], model: ModelEntry): boolean => {
  if (model.context_length <= 0 || estimate_messages(messages) <= model.context_length * trim_fraction) {
    return false;
  }
  let changed = false;
  for (const message of messages) {
    if (message.role !== "tool" || message.content === trimmed_stub || estimate_tokens(message.content) < min_trimmable_tokens) {
      continue;
    }
    message.content = trimmed_stub;
    changed = true;
    if (estimate_messages(messages) <= model.context_length * trim_fraction) {
      break;
    }
  }
  return changed;
};
