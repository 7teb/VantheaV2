import type { ToolSpec } from "../../tools/types.ts";
import { as_record, as_string, type JsonRecord } from "../json.ts";
import { sent_messages, type ApiAssistantMessage, type ApiContentPart, type ApiMessage } from "../types.ts";

export const output_wrapper_type = "responses_output";

type InputItem = Record<string, unknown>;

const without_arguments = (item: Record<string, unknown>): Record<string, unknown> =>
  item.type === "function_call" ? Object.fromEntries(Object.entries(item).filter(([key]) => key !== "arguments")) : item;

export const wrap_output = (items: Record<string, unknown>[]): unknown[] => [{ type: output_wrapper_type, items: items.map(without_arguments) }];

export const is_plan_output = (details: readonly unknown[]): boolean => details.length === 1 && as_record(details[0])?.type === output_wrapper_type;

const carries_wrapper = (message: ApiMessage): message is ApiAssistantMessage =>
  message.role === "assistant" && Boolean(message.reasoning_details?.some((entry) => as_record(entry)?.type === output_wrapper_type));

export const without_plan_items = (messages: ApiMessage[]): ApiMessage[] => {
  if (!messages.some(carries_wrapper)) {
    return messages;
  }
  return messages.map((message) => {
    if (!carries_wrapper(message)) {
      return message;
    }
    const copy: ApiAssistantMessage = { ...message };
    delete copy.reasoning_details;
    return copy;
  });
};

const user_content = (content: string | ApiContentPart[]): string | InputItem[] => {
  if (typeof content === "string") {
    return content;
  }
  return content.map((part) =>
    part.type === "text" ? { type: "input_text", text: part.text } : { type: "input_image", image_url: part.image_url.url, detail: part.image_url.detail ?? "auto" },
  );
};

const tools_item = (tools: ToolSpec[]): InputItem => ({
  type: "additional_tools",
  role: "developer",
  tools: tools.map((spec) => ({ type: "function", name: spec.name, description: spec.description, parameters: spec.parameters, strict: false })),
});

const wrapper_items = (message: ApiAssistantMessage): JsonRecord[] | null => {
  const details = message.reasoning_details ?? [];
  if (details.length !== 1) {
    return null;
  }
  const wrapper = as_record(details[0]);
  if (wrapper?.type !== output_wrapper_type || !Array.isArray(wrapper.items)) {
    return null;
  }
  const kept = wrapper.items.map((item) => as_record(item)).filter((item): item is JsonRecord => item !== null);
  if (kept.length !== wrapper.items.length) {
    return null;
  }
  const calls = kept.filter((item) => item.type === "function_call").length;
  return calls === (message.tool_calls?.length ?? 0) ? kept : null;
};

const replayed_items = (items: JsonRecord[], message: ApiAssistantMessage, call_ids: Map<string, string>): InputItem[] => {
  const calls = message.tool_calls ?? [];
  let position = 0;
  return items.map((item) => {
    if (item.type !== "function_call") {
      return item;
    }
    const call = calls[position];
    position += 1;
    call_ids.set(call.id, as_string(item.call_id) || call.id);
    return { ...item, arguments: call.function.arguments };
  });
};

const resendable = (item: JsonRecord): boolean => item.type !== "reasoning" || (typeof item.encrypted_content === "string" && item.encrypted_content !== "");

const plain_assistant = (message: ApiAssistantMessage): InputItem[] => [
  ...(message.content ? [{ type: "message", role: "assistant", content: message.content }] : []),
  ...(message.tool_calls ?? []).map((call) => ({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments })),
];

export const plan_input = (messages: ApiMessage[], tools: ToolSpec[]): InputItem[] => {
  const sent = sent_messages(messages);
  const call_ids = new Map<string, string>();
  const items: InputItem[] = [];
  let unreplayable = 0;
  for (const { message } of sent) {
    if (message.role === "system") {
      items.push({ type: "message", role: "developer", content: message.content });
      continue;
    }
    if (message.role === "user") {
      items.push({ type: "message", role: "user", content: user_content(message.content) });
      continue;
    }
    if (message.role === "tool") {
      items.push({ type: "function_call_output", call_id: call_ids.get(message.tool_call_id) ?? message.tool_call_id, output: message.content });
      continue;
    }
    const replay = wrapper_items(message);
    if (!replay) {
      items.push(...plain_assistant(message));
      continue;
    }
    const kept = replay.filter(resendable);
    unreplayable += replay.length - kept.length;
    items.push(...replayed_items(kept, message, call_ids));
  }
  if (unreplayable) {
    console.warn(`[plan] left out ${unreplayable} reasoning item(s) that carry no encrypted content`);
  }
  if (tools.length) {
    items.splice(sent[0]?.message.role === "system" ? 1 : 0, 0, tools_item(tools));
  }
  return items;
};
