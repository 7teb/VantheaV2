import { plan_slug, reasoning_fields } from "../catalog.ts";
import type { CompleteRequest } from "../completion-body.ts";
import { ModelError } from "../errors.ts";
import type { RoundRequest } from "../types.ts";
import { plan_input } from "./input.ts";

const slug_of = (model_id: string): string => {
  const slug = plan_slug(model_id);
  if (slug === null) {
    throw new ModelError("bad_request", `ChatGPT plan: ${model_id} is not an OpenAI model, so the plan cannot run it.`);
  }
  return slug;
};

export const round_plan_body = (request: RoundRequest): Record<string, unknown> => {
  const { model } = request;
  return {
    model: slug_of(model.id),
    input: plan_input(request.messages, request.tools),
    store: false,
    stream: true,
    ...(model.efforts.length ? { reasoning: reasoning_fields(model, request.effort) } : {}),
    ...(model.verbosity ? { text: { verbosity: model.verbosity } } : {}),
    ...(model.service_tier ? { service_tier: model.service_tier } : {}),
    ...(request.tool_choice === "none" && request.tools.length ? { tool_choice: "none" } : {}),
  };
};

const text_format = (request: CompleteRequest): Record<string, unknown> => {
  if (request.schema) {
    return { text: { format: { type: "json_schema", name: request.schema.name, schema: request.schema.schema, strict: request.schema.strict } } };
  }
  return request.json ? { text: { format: { type: "json_object" } } } : {};
};

export const complete_plan_body = (request: CompleteRequest): Record<string, unknown> => ({
  model: slug_of(request.model_id),
  input: plan_input(request.messages, []),
  store: false,
  stream: true,
  ...(request.reasoning_effort ? { reasoning: { effort: request.reasoning_effort } } : {}),
  ...text_format(request),
});
