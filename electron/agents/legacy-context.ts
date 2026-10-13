import type { ApiMessage } from "../model/types.ts";
import { inbox_note } from "./prompt.ts";

const inbox_prefix = inbox_note("").content;

const marked = (message: ApiMessage): boolean => message.role === "user" && Boolean(message.instruction || message.compaction);

export const mark_task_prompts = (messages: ApiMessage[], prompts: string[]): ApiMessage[] => {
  if (messages.some(marked)) {
    return messages;
  }
  const first = messages.findIndex((message) => message.role === "user");
  const known = new Set(prompts);
  return messages.map((message, index) => {
    if (message.role !== "user" || typeof message.content !== "string") {
      return message;
    }
    const task = index === first || known.has(message.content) || message.content.startsWith(inbox_prefix);
    return task ? { ...message, instruction: true } : message;
  });
};
