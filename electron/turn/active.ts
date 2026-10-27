import { randomUUID } from "node:crypto";
import type { AssistantReference, Attachment, SteerMessage } from "../../shared/chat.ts";
import type { ModelEntry } from "../../shared/models.ts";
import type { Emitter } from "./session.ts";
import { add_authorization } from "../permissions/context.ts";

export type ActiveTurn = {
  controller: AbortController;
  message_id: string;
  steers: SteerMessage[];
  notes: Map<string, Promise<Attachment[]>>;
  ended: boolean;
  emit: Emitter;
  model: ModelEntry;
  effort: string;
  visible_text: string;
};

const active = new Map<string, ActiveTurn>();

const reserved = new Set<string>();

const stopped_by_user = new Set<string>();

const change_listeners = new Set<() => void>();

const announce_change = () => {
  for (const listener of change_listeners) {
    try {
      listener();
    } catch (error) {
      console.error("[turn] a listener for the set of active turns failed:", error);
    }
  }
};

export const on_active_turns_changed = (listener: () => void): (() => void) => {
  change_listeners.add(listener);
  return () => change_listeners.delete(listener);
};

export const is_active = (chat_id: string): boolean => active.has(chat_id) || reserved.has(chat_id);

export const reserve_chat = (chat_id: string): boolean => {
  if (is_active(chat_id)) {
    return false;
  }
  reserved.add(chat_id);
  return true;
};

export const release_chat = (chat_id: string): void => {
  if (reserved.delete(chat_id)) {
    announce_change();
  }
};

export const turn_settled = (chat_id: string): Promise<void> =>
  new Promise((resolve) => {
    if (!is_active(chat_id)) {
      resolve();
      return;
    }
    const stop = on_active_turns_changed(() => {
      if (is_active(chat_id)) {
        return;
      }
      stop();
      resolve();
    });
  });

export const active_turn = (chat_id: string): ActiveTurn | null => active.get(chat_id) ?? null;

export const mark_user_stop = (chat_id: string): void => {
  stopped_by_user.add(chat_id);
};

export const user_stopped = (chat_id: string): boolean => stopped_by_user.has(chat_id);

export const forget_user_stop = (chat_id: string): void => {
  stopped_by_user.delete(chat_id);
};

export const register_active = (chat_id: string, message_id: string, emit: Emitter, model: ModelEntry, effort: string): ActiveTurn => {
  const visible: { round: number; text: string }[] = [];
  let last_text = false;
  const turn: ActiveTurn = {
    controller: new AbortController(),
    message_id,
    steers: [],
    notes: new Map(),
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
  stopped_by_user.delete(chat_id);
  active.set(chat_id, turn);
  announce_change();
  return turn;
};

export const unregister_active = (chat_id: string, message_id: string): void => {
  if (active.get(chat_id)?.message_id === message_id) {
    active.delete(chat_id);
    announce_change();
  }
};

export const active_assistant_reference = (chat_id: string): AssistantReference | undefined => {
  const turn = active.get(chat_id);
  return turn ? { message_id: turn.message_id, text: turn.visible_text } : undefined;
};

export const steer_target = (chat_id: string): ActiveTurn | null => {
  const turn = active.get(chat_id);
  return turn && !turn.ended && !turn.controller.signal.aborted ? turn : null;
};

export const push_steer = (chat_id: string, text: string, id: string = randomUUID(), attachments: Attachment[] = [], assistant_reference = active_assistant_reference(chat_id)): boolean => {
  const turn = steer_target(chat_id);
  if (!turn) {
    return false;
  }
  if (!turn.steers.some((entry) => entry.id === id)) {
    const at = Date.now();
    turn.steers.push({ id, text, at, attachments, ...(assistant_reference ? { assistant_reference } : {}) });
    add_authorization(chat_id, id, text, assistant_reference, attachments, at);
  }
  return true;
};

export const has_steers = (chat_id: string): boolean => Boolean(active.get(chat_id)?.steers.length);

export const drop_untaken_steers = (chat_id: string, turn: ActiveTurn): void => {
  const left = turn.steers.splice(0);
  if (!left.length) {
    return;
  }
  const listed = left.map((steer) => `${steer.id} (attachments: ${steer.attachments.map((attachment) => attachment.id).join(", ") || "none"})`).join("; ");
  console.warn(`[turn] turn ${turn.message_id} in chat ${chat_id} ended with steers it did not take: ${listed}`);
};

export const take_steer_active = (chat_id: string, steer_id: string): SteerMessage | null => {
  const turn = active.get(chat_id);
  const at = turn ? turn.steers.findIndex((entry) => entry.id === steer_id) : -1;
  if (!turn || at < 0) {
    return null;
  }
  turn.notes.delete(steer_id);
  return turn.steers.splice(at, 1)[0] ?? null;
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
