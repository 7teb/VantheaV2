import { apply_event } from "../../shared/apply-event.ts";
import type { AssistantMessage, Message } from "../../shared/chat.ts";
import type { Sequenced, StreamEventBody, TurnEvent } from "../../shared/events.ts";
import type { Emitter } from "./session.ts";

export type EmitDeps = {
  update_message: (chat_id: string, message_id: string, fn: (message: Message) => Message) => void;
  forward: (event: TurnEvent) => void;
  flush: (chat_id: string) => void;
};

export type QuietEnd = (message: AssistantMessage, end: Extract<StreamEventBody, { type: "end" }>) => boolean;

export const create_emitter = (chat_id: string, message_id: string, deps: EmitDeps, quiet_end?: QuietEnd): Emitter => {
  let seq = 0;
  let ended = false;
  return (body: StreamEventBody) => {
    if (ended) {
      return;
    }
    ended = body.type === "end";
    seq += 1;
    const at = Date.now();
    let event: Sequenced & StreamEventBody = { ...body, seq, at };
    deps.update_message(chat_id, message_id, (message) => {
      if (message.role !== "assistant") {
        return message;
      }
      if (body.type === "end" && quiet_end?.(message, body)) {
        event = { ...body, seq, at, quiet: true };
      }
      return apply_event(message, event);
    });
    deps.forward({ ...event, chat_id, message_id });
    if (body.type === "end") {
      deps.flush(chat_id);
    }
  };
};
