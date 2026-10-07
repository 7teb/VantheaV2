import { apply_event } from "../../shared/apply-event.ts";
import type { Message } from "../../shared/chat.ts";
import type { StreamEventBody, TurnEvent } from "../../shared/events.ts";
import type { Emitter } from "./session.ts";

export type EmitDeps = {
  update_message: (chat_id: string, message_id: string, fn: (message: Message) => Message) => void;
  forward: (event: TurnEvent) => void;
  flush: (chat_id: string) => void;
};

export const create_emitter = (chat_id: string, message_id: string, deps: EmitDeps): Emitter => {
  let seq = 0;
  let ended = false;
  return (body: StreamEventBody) => {
    if (ended) {
      return;
    }
    ended = body.type === "end";
    seq += 1;
    const event = { ...body, seq, at: Date.now() };
    deps.update_message(chat_id, message_id, (message) => (message.role === "assistant" ? apply_event(message, event) : message));
    deps.forward({ ...event, chat_id, message_id });
    if (body.type === "end") {
      deps.flush(chat_id);
    }
  };
};
