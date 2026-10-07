import { apply_event } from "../../shared/apply-event.ts";
import type { AssistantMessage, Message } from "../../shared/chat.ts";

const app_closed_message = "The app was closed while this turn was still running.";

export const interrupt_message = (message: AssistantMessage, at: number): AssistantMessage =>
  apply_event(message, {
    seq: message.last_seq + 1,
    at,
    type: "end",
    status: "interrupted",
    error: { kind: "app_closed", message: app_closed_message },
  });

export const settle_streaming = (messages: Message[], at: number): Message[] | null => {
  if (!messages.some((message) => message.role === "assistant" && message.status === "streaming")) {
    return null;
  }
  return messages.map((message) => (message.role === "assistant" && message.status === "streaming" ? interrupt_message(message, at) : message));
};
