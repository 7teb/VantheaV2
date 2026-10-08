import { randomUUID } from "node:crypto";
import type { AssistantReference, Attachment, SteerMessage } from "../../shared/chat.ts";
import type { ModelEntry } from "../../shared/models.ts";
import type { Emitter } from "./session.ts";
import { add_authorization } from "../permissions/context.ts";

export type ActiveTurn = { controller: AbortController; message_id: string; steers: SteerMessage[]; ended: boolean; emit: Emitter; model: ModelEntry; effort: string; visible_text: string };

const active = new Map<string, ActiveTurn>();

const reserved = new Set<string>();

export const is_active = (chat_id: string): boolean => active.has(chat_id) || reserved.has(chat_id);

export const reserve_chat = (chat_id: string): boolean => {
  if (is_active(chat_id)) {
    return false;
  }
  reserved.add(chat_id);
  return true;
};

export const release_chat = (chat_id: string): void => {
  reserved.delete(chat_id);
};

export const active_turn = (chat_id: string): ActiveTurn | null => active.get(chat_id) ?? null;

export const register_active = (chat_id: string, message_id: string, emit: Emitter, model: ModelEntry, effort: string): ActiveTurn => {
  const visible: { round: number; text: string }[] = [];
  let last_text = false;
  const turn: ActiveTurn = {
    controller: new AbortController(),
    message_id,
    steers: [],
    ended: false,
    model,
    effort,
    visible_text: "",
    emit: (body) => {
      if (body.type === "text" && body.delta) {
        const last = visible.at(-1);
        if (last_text && last?.round === body.round) last.text += body.delta;
        else visible.push({ round: body.round, text: body.delta });
        turn.visible_text = visible.map(entry => entry.text).join("\n\n");
        last_text = true;
      } else if (body.type === "retry") {
        for (let at = visible.length - 1; at >= 0; at -= 1) {
          if (visible[at]!.round === body.round) visible.splice(at, 1);
        }
        turn.visible_text = visible.map(entry => entry.text).join("\n\n");
        last_text = false;
      } else if (["reasoning", "tool_draft", "tool_call", "steer", "notice", "compaction"].includes(body.type)) {
        last_text = false;
      }
      if (body.type === "end") {
        turn.ended = true;
      }
      emit(body);
    },
  };
  active.set(chat_id, turn);
  return turn;
};

export const unregister_active = (chat_id: string, message_id: string): void => {
  if (active.get(chat_id)?.message_id === message_id) {
    active.delete(chat_id);
  }
};

export const active_assistant_reference = (chat_id: string): AssistantReference | undefined => {
  const turn = active.get(chat_id);
  return turn ? { message_id: turn.message_id, text: turn.visible_text } : undefined;
};

export const push_steer = (chat_id: string, text: string, id: string = randomUUID(), attachments: Attachment[] = [], assistant_reference = active_assistant_reference(chat_id)): boolean => {
  const turn = active.get(chat_id);
  if (!turn || turn.ended || turn.controller.signal.aborted) {
    return false;
  }
  if (!turn.steers.some((entry) => entry.id === id)) {
    turn.steers.push({ id, text, attachments, ...(assistant_reference ? { assistant_reference } : {}) });
    add_authorization(chat_id, id, text, assistant_reference, attachments);
  }
  return true;
};

export const has_steers = (chat_id: string): boolean => Boolean(active.get(chat_id)?.steers.length);

export const take_steers_active = (chat_id: string): SteerMessage[] => {
  const turn = active.get(chat_id);
  if (!turn || !turn.steers.length) {
    return [];
  }
  const taken = turn.steers;
  turn.steers = [];
  return taken;
};

export const abort_turn = (chat_id: string, reason: Error): boolean => {
  const turn = active.get(chat_id);
  if (!turn) {
    return false;
  }
  turn.controller.abort(reason);
  return true;
};

export const active_turns = (): [string, ActiveTurn][] => [...active.entries()];

export const clear_active = (): void => active.clear();
