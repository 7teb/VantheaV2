import type { ModelEntry } from "../../shared/models.ts";
import { reasoning_bound_to_prefix } from "../model/prompt-cache.ts";
import type { ApiMessage } from "../model/types.ts";
import { estimate_tokens } from "./estimate.ts";
import { drop_reasoning_after, image_slots, stub_image } from "./images.ts";
import { estimate_messages } from "./usage.ts";

export const trimmed_stub = "[earlier tool output trimmed to save context]";

export const screenshot_stub = "[earlier screenshot removed to save context]";

const trim_fraction = 0.9;

const min_trimmable_tokens = 200;

const trimmable_text = (message: ApiMessage) => message.role === "tool" && message.content !== trimmed_stub && estimate_tokens(message.content) >= min_trimmable_tokens;

export const trim_tool_messages = (messages: ApiMessage[], model: ModelEntry, fraction = trim_fraction, scale = 1): boolean => {
  const fits = () => Math.ceil(estimate_messages(messages) * scale) <= model.context_length * fraction;
  if (model.context_length <= 0 || fits()) {
    return false;
  }
  const carrier_slots = image_slots(messages).filter((slot) => slot.carrier);
  let first = -1;
  for (const [index, message] of messages.entries()) {
    const slots = carrier_slots.filter((slot) => slot.message === index);
    if (!trimmable_text(message) && !slots.length) {
      continue;
    }
    if (message.role === "tool") {
      message.content = trimmed_stub;
    }
    for (const slot of slots) {
      stub_image(messages, slot, screenshot_stub);
    }
    first = first < 0 ? index : first;
    if (fits()) {
      break;
    }
  }
  if (first < 0) {
    return false;
  }
  if (reasoning_bound_to_prefix(model.id)) {
    drop_reasoning_after(messages, first);
  }
  return true;
};
