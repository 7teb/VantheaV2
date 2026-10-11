import { safety_fields } from "./safety.ts";
import { wire_messages, type ApiMessage } from "./types.ts";

export type ResponseSchema = { name: string; schema: Record<string, unknown>; strict: boolean };

export type CompleteRequest = {
  model_id: string;
  messages: ApiMessage[];
  max_tokens: number;
  temperature?: number;
  json?: boolean;
  schema?: ResponseSchema;
  reasoning_effort?: string;
  session_id?: string;
  prompt_cache_options?: { mode: "explicit" };
  provider?: { order: string[] };
};

const response_format = (request: CompleteRequest): Record<string, unknown> => {
  if (request.schema) {
    return { response_format: { type: "json_schema", json_schema: request.schema } };
  }
  return request.json ? { response_format: { type: "json_object" } } : {};
};

export const completion_body = (request: CompleteRequest): Record<string, unknown> => ({
  model: request.model_id,
  ...(request.session_id ? { session_id: request.session_id } : {}),
  ...(request.provider ? { provider: request.provider } : {}),
  messages: wire_messages(request.messages, false),
  ...(request.prompt_cache_options ? { prompt_cache_options: request.prompt_cache_options } : {}),
  max_completion_tokens: request.max_tokens,
  ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
  ...(request.reasoning_effort ? { reasoning: { effort: request.reasoning_effort } } : {}),
  ...response_format(request),
  ...safety_fields(request.model_id),
});
