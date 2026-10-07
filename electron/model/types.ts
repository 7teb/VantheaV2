import type { ModelEntry } from "../../shared/models.ts";
import type { JsonSchema, ToolSpec } from "../tools/types.ts";

export type ApiTextPart = { type: "text"; text: string };

export type ApiImagePart = { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export type ApiContentPart = ApiTextPart | ApiImagePart;

export type ApiToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ApiSystemMessage = { role: "system"; content: string };

export type ApiUserMessage = { role: "user"; content: string | ApiContentPart[] };

export type ApiAssistantMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: ApiToolCall[];
  reasoning_details?: unknown[];
  reasoning?: string;
};

export type ApiToolMessage = { role: "tool"; tool_call_id: string; content: string };

export type ApiMessage = ApiSystemMessage | ApiUserMessage | ApiAssistantMessage | ApiToolMessage;

export type ApiTool = { type: "function"; function: { name: string; description: string; parameters: JsonSchema } };

export type RoundUsage = { prompt_tokens: number; completion_tokens: number; reasoning_tokens: number };

export type RoundToolCall = { index: number; id: string; name: string; arguments: string };

export type RoundRequest = { model: ModelEntry; effort: string; messages: ApiMessage[]; tools: ToolSpec[] };

export type RoundCallbacks = {
  on_text(delta: string): void;
  on_reasoning(delta: string): void;
  on_tool_draft(index: number, name: string, lines: number | null): void;
  on_retry(attempt: number, max: number, reason: string, wait_ms: number): void;
};

export type RoundResult = {
  status: "completed" | "cancelled";
  content: string;
  reasoning: string;
  reasoning_details: unknown[];
  tool_calls: RoundToolCall[];
  finish_reason: string;
  usage: RoundUsage | null;
};

export const to_api_tools = (specs: ToolSpec[]): ApiTool[] =>
  specs.map((spec) => ({ type: "function", function: { name: spec.name, description: spec.description, parameters: spec.parameters } }));

const passback_placeholder = " ";

const reasoning_text = (reasoning: string | undefined, required: boolean): string => {
  if (reasoning) {
    return reasoning;
  }
  return required ? passback_placeholder : "";
};

const wire_message = (message: ApiMessage, keep_reasoning: boolean, reasoning_required: boolean): ApiMessage => {
  if (message.role !== "assistant") {
    return message;
  }
  const { tool_calls, reasoning_details, reasoning, ...rest } = message;
  const details = keep_reasoning && reasoning_details?.length ? reasoning_details : null;
  const text = keep_reasoning && !details ? reasoning_text(reasoning, reasoning_required) : "";
  return {
    ...rest,
    ...(tool_calls?.length ? { tool_calls } : {}),
    ...(details ? { reasoning_details: details } : {}),
    ...(text ? { reasoning: text } : {}),
  };
};

const empty_assistant = (message: ApiMessage) => message.role === "assistant" && !message.content && !message.tool_calls?.length;

export const wire_messages = (messages: ApiMessage[], reasoning_passback: boolean): ApiMessage[] => {
  const sent = messages.filter((message) => !empty_assistant(message));
  const last_user = sent.findLastIndex((message) => message.role === "user");
  return sent.map((message, index) => {
    const current_turn = index > last_user;
    return wire_message(message, reasoning_passback || current_turn, reasoning_passback && current_turn);
  });
};
