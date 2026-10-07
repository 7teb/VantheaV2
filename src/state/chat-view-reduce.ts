import { apply_event } from "../../shared/apply-event.ts";
import type { AssistantMessage, Chat, ContextUsage, Message } from "../../shared/chat.ts";
import type { UndoResult } from "../../shared/ipc/chats.ts";
import type { Delivery } from "../api/smoother.ts";

export type EventDelivery = Extract<Delivery, { kind: "event" }>;

type EntryBase = {
  held: Delivery[];
  waiting: Record<string, EventDelivery[]>;
  stale: boolean;
  context: ContextUsage | null;
  reverted: Record<string, UndoResult>;
};

export type ChatEntry = EntryBase &
  ({ status: "loading"; chat: Chat | null } | { status: "ready"; chat: Chat } | { status: "failed"; chat: null });

type ReadyEntry = Extract<ChatEntry, { status: "ready" }>;

export type ChatViewState = { entries: Record<string, ChatEntry>; recent: string[] };

export const max_loaded_chats = 8;

export const max_buffered = 4000;

export const empty_chat_view: ChatViewState = { entries: {}, recent: [] };

const omit_key = <T>(record: Record<string, T>, key: string): Record<string, T> => {
  const copy = { ...record };
  delete copy[key];
  return copy;
};

const with_entry = (state: ChatViewState, chat_id: string, entry: ChatEntry): ChatViewState => ({
  ...state,
  entries: { ...state.entries, [chat_id]: entry },
});

export const open_entry = (state: ChatViewState, chat_id: string): ChatViewState => {
  if (state.recent.at(-1) === chat_id) {
    return state;
  }
  const recent = [...state.recent.filter((id) => id !== chat_id), chat_id];
  if (recent.length <= max_loaded_chats) {
    return { ...state, recent };
  }
  const evicted = new Set(recent.slice(0, recent.length - max_loaded_chats));
  const entries = Object.fromEntries(Object.entries(state.entries).filter(([id]) => !evicted.has(id)));
  return { entries, recent: recent.filter((id) => !evicted.has(id)) };
};

export const begin_load = (state: ChatViewState, chat_id: string): ChatViewState => {
  const current = state.entries[chat_id];
  const entry: ChatEntry = {
    status: "loading",
    chat: current?.chat ?? null,
    held: [],
    waiting: {},
    stale: false,
    context: current?.context ?? null,
    reverted: current?.reverted ?? {},
  };
  return open_entry(with_entry(state, chat_id, entry), chat_id);
};

export const apply_delivery = (message: AssistantMessage, delivery: EventDelivery): AssistantMessage => {
  const next = apply_event(message, delivery.event);
  if (next === message || !delivery.partial) {
    return next;
  }
  return { ...next, last_seq: message.last_seq };
};

const replace_message = (entry: ReadyEntry, index: number, message: Message): ReadyEntry => {
  const messages = entry.chat.messages.slice();
  messages[index] = message;
  return { ...entry, chat: { ...entry.chat, messages } };
};

const apply_waiting = (entry: ReadyEntry, message_id: string): ReadyEntry => {
  const waiting = entry.waiting[message_id];
  if (!waiting) {
    return entry;
  }
  const cleared = { ...entry, waiting: omit_key(entry.waiting, message_id) };
  const index = cleared.chat.messages.findIndex((message) => message.id === message_id);
  const message = cleared.chat.messages[index];
  if (message?.role !== "assistant") {
    return cleared;
  }
  return replace_message(cleared, index, waiting.reduce(apply_delivery, message));
};

const buffer_event = (entry: ReadyEntry, delivery: EventDelivery): ReadyEntry => {
  const message_id = delivery.event.message_id;
  const waiting = entry.waiting[message_id] ?? [];
  if (waiting.length >= max_buffered) {
    return { ...entry, waiting: omit_key(entry.waiting, message_id), stale: true };
  }
  return { ...entry, waiting: { ...entry.waiting, [message_id]: [...waiting, delivery] } };
};

const apply_to_ready = (entry: ReadyEntry, delivery: Delivery): ReadyEntry => {
  const messages = entry.chat.messages;
  if (delivery.kind === "appended") {
    if (messages.some((message) => message.id === delivery.message.id)) {
      return entry;
    }
    const appended = { ...entry, chat: { ...entry.chat, messages: [...messages, delivery.message] } };
    return apply_waiting(appended, delivery.message.id);
  }
  if (delivery.kind === "replaced") {
    const index = messages.findIndex((message) => message.id === delivery.message.id);
    return index === -1 ? entry : replace_message(entry, index, delivery.message);
  }
  if (delivery.kind === "truncated") {
    const index = messages.findIndex((message) => message.id === delivery.message_id);
    if (index === -1 || index === messages.length - 1) {
      return entry;
    }
    return { ...entry, chat: { ...entry.chat, messages: messages.slice(0, index + 1) } };
  }
  const index = messages.findIndex((message) => message.id === delivery.event.message_id);
  if (index === -1) {
    return buffer_event(entry, delivery);
  }
  const message = messages[index];
  if (message.role !== "assistant") {
    return entry;
  }
  const next = apply_delivery(message, delivery);
  return next === message ? entry : replace_message(entry, index, next);
};

export const delivery_chat = (delivery: Delivery) => (delivery.kind === "event" ? delivery.event.chat_id : delivery.chat_id);

const receive_one = (state: ChatViewState, delivery: Delivery): ChatViewState => {
  const chat_id = delivery_chat(delivery);
  const entry = state.entries[chat_id];
  if (!entry || entry.status === "failed") {
    return state;
  }
  if (entry.status === "loading") {
    const held = entry.held.length >= max_buffered ? { held: [], stale: true } : { held: [...entry.held, delivery] };
    return with_entry(state, chat_id, { ...entry, ...held });
  }
  const next = apply_to_ready(entry, delivery);
  return next === entry ? state : with_entry(state, chat_id, next);
};

export const receive = (state: ChatViewState, batch: Delivery[]): ChatViewState => batch.reduce(receive_one, state);

export const finish_load = (state: ChatViewState, chat_id: string, chat: Chat | null): ChatViewState => {
  const entry = state.entries[chat_id];
  if (!entry || entry.status !== "loading") {
    return state;
  }
  if (!chat) {
    return with_entry(state, chat_id, { ...entry, status: "failed", chat: null, held: [] });
  }
  const ready: ReadyEntry = { ...entry, status: "ready", chat, held: [] };
  return entry.held.reduce(receive_one, with_entry(state, chat_id, ready));
};

export const fail_load = (state: ChatViewState, chat_id: string): ChatViewState => {
  const entry = state.entries[chat_id];
  if (!entry || entry.status !== "loading") {
    return state;
  }
  if (entry.chat) {
    return with_entry(state, chat_id, { ...entry, status: "ready", chat: entry.chat, held: [] });
  }
  return with_entry(state, chat_id, { ...entry, status: "failed", chat: null, held: [] });
};

export const set_context = (state: ChatViewState, chat_id: string, usage: ContextUsage): ChatViewState => {
  const entry = state.entries[chat_id];
  return entry ? with_entry(state, chat_id, { ...entry, context: usage }) : state;
};

export const mark_reverted = (state: ChatViewState, chat_id: string, message_id: string, result: UndoResult): ChatViewState => {
  const entry = state.entries[chat_id];
  return entry ? with_entry(state, chat_id, { ...entry, reverted: { ...entry.reverted, [message_id]: result } }) : state;
};

export const stale_chats = (state: ChatViewState): string[] =>
  Object.entries(state.entries)
    .filter(([, entry]) => entry.stale && entry.status === "ready")
    .map(([chat_id]) => chat_id);

export const last_assistant = (chat: Chat): AssistantMessage | null => {
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];
    if (message.role === "assistant") {
      return message;
    }
  }
  return null;
};

export const entry_streaming = (entry: ChatEntry | undefined): boolean | null => {
  if (!entry?.chat) {
    return null;
  }
  return last_assistant(entry.chat)?.status === "streaming";
};
