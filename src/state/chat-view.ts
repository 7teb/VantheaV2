import type { FinalStatus } from "../../shared/events.ts";
import type { CompactResult } from "../../shared/ipc/chats.ts";
import { api } from "../api/bridge.ts";
import type { Delivery } from "../api/smoother.ts";
import { start_stream } from "../api/stream.ts";
import { begin_load, empty_chat_view, fail_load, finish_load, open_entry, receive, set_context, stale_chats, type ChatViewState } from "./chat-view-reduce.ts";
import { create_store } from "./create-store.ts";

export const chat_view_store = create_store<ChatViewState>(empty_chat_view);

type EndListener = (chat_id: string, status: FinalStatus, message_id: string) => void;

type SteerListener = (chat_id: string, steer_id: string) => void;

const steer_listeners = new Set<SteerListener>();

export const on_steer_taken = (listener: SteerListener): (() => void) => {
  steer_listeners.add(listener);
  return () => {
    steer_listeners.delete(listener);
  };
};

const end_listeners = new Set<EndListener>();

export const on_turn_end = (listener: EndListener): (() => void) => {
  end_listeners.add(listener);
  return () => {
    end_listeners.delete(listener);
  };
};

const reload_stale = () => {
  for (const chat_id of stale_chats(chat_view_store.get())) {
    void load_chat(chat_id);
  }
};

export const load_chat = async (chat_id: string) => {
  chat_view_store.update((state) => begin_load(state, chat_id));
  try {
    const chat = await api.invoke("chats:get", chat_id);
    chat_view_store.update((state) => finish_load(state, chat_id, chat));
  } catch (error) {
    console.error(`[chat-view] chats:get failed for chat ${chat_id}`, error);
    chat_view_store.update((state) => fail_load(state, chat_id));
  }
  reload_stale();
};

const refresh_context = async (chat_id: string) => {
  try {
    const usage = await api.invoke("turn:context", chat_id);
    chat_view_store.update((state) => set_context(state, chat_id, usage));
  } catch (error) {
    console.error(`[chat-view] turn:context failed for chat ${chat_id}`, error);
  }
};

export const compact_chat_now = async (chat_id: string): Promise<CompactResult["status"]> => {
  try {
    const result = await api.invoke("turn:compact", chat_id);
    if (result.status === "done") {
      await load_chat(chat_id);
      await refresh_context(chat_id);
    }
    return result.status;
  } catch (error) {
    console.error(`[chat-view] turn:compact failed for chat ${chat_id}`, error);
    return "failed";
  }
};

export const open_chat_view = (chat_id: string) => {
  const entry = chat_view_store.get().entries[chat_id];
  if (entry && entry.status !== "failed") {
    chat_view_store.update((state) => open_entry(state, chat_id));
  } else {
    void load_chat(chat_id);
  }
  void refresh_context(chat_id);
};

const deliver = (batch: Delivery[]) => {
  chat_view_store.update((state) => receive(state, batch));
  reload_stale();
  for (const delivery of batch) {
    if (delivery.kind !== "event") {
      continue;
    }
    const event = delivery.event;
    if (event.type === "steer" && event.steer_id) {
      for (const listener of [...steer_listeners]) {
        listener(event.chat_id, event.steer_id);
      }
      continue;
    }
    if (event.type !== "end") {
      continue;
    }
    const { chat_id, status, message_id } = event;
    if (chat_view_store.get().entries[chat_id]) {
      void refresh_context(chat_id);
    }
    for (const listener of [...end_listeners]) {
      listener(chat_id, status, message_id);
    }
  }
};

export const init_chat_view = (): (() => void) => start_stream(deliver);
