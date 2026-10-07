import type { ApiAssistantMessage, ApiContentPart, ApiMessage } from "../model/types.ts";
import type { ToolSpec } from "../tools/types.ts";
import { estimate_tokens } from "./estimate.ts";

const image_tokens = 1600;

const part_tokens = (part: ApiContentPart): number => (part.type === "text" ? estimate_tokens(part.text) : image_tokens);

const content_tokens = (content: ApiMessage["content"]): number => {
  if (typeof content === "string") {
    return estimate_tokens(content);
  }
  return Array.isArray(content) ? content.reduce((sum, part) => sum + part_tokens(part), 0) : 0;
};

const reasoning_tokens = (message: ApiAssistantMessage): number =>
  message.reasoning_details?.length ? estimate_tokens(JSON.stringify(message.reasoning_details)) : estimate_tokens(message.reasoning ?? "");

const message_tokens = (message: ApiMessage): number => {
  const content = content_tokens(message.content);
  if (message.role !== "assistant") {
    return content;
  }
  const calls = message.tool_calls?.length ? estimate_tokens(message.tool_calls.map((call) => `${call.function.name}${call.function.arguments}`).join("")) : 0;
  return content + calls + reasoning_tokens(message);
};

export const estimate_messages = (messages: ApiMessage[]): number => messages.reduce((sum, message) => sum + message_tokens(message), 0);

export const estimate_request = (messages: ApiMessage[], tools: ToolSpec[]): number =>
  estimate_messages(messages) + (tools.length ? estimate_tokens(JSON.stringify(tools)) : 0);
