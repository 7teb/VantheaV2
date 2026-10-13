import type { ReviewCall } from "../tools/types.ts";
import type { CompleteRequest } from "./completion-body.ts";
import { explicit_review_cache, review_markers } from "./prompt-cache.ts";
import type { ApiTextPart } from "./types.ts";

const review_routing = (model_id: string) =>
  explicit_review_cache(model_id) ? { prompt_cache_options: { mode: "explicit" as const }, provider: { order: ["openai"] } } : {};

export const review_request = (model_id: string, call: ReviewCall): CompleteRequest => {
  const markers = review_markers(model_id, call.system, call.parts);
  const content: ApiTextPart[] = call.parts.map((part, index) => ({ type: "text", text: part.text, ...(markers[index] ? { prompt_cache_breakpoint: { mode: "explicit" as const } } : {}) }));
  return {
    model_id,
    messages: [
      { role: "system", content: call.system },
      { role: "user", content },
    ],
    schema: { name: call.schema.name, schema: call.schema.schema, strict: true },
    reasoning_effort: "low",
    session_id: call.session_id,
    ...review_routing(model_id),
  };
};
