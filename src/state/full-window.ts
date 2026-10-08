import type { FullWindow } from "../../shared/ipc/chats.ts";
import { api } from "../api/bridge.ts";
import type { ActionResult } from "./chat-actions.ts";
import { create_store } from "./create-store.ts";
import { on_active_chat } from "./ui.ts";

export type FullWindowState = { chat_id: string | null; until: number | null };

export const full_window_store = create_store<FullWindowState>({ chat_id: null, until: null });

let ticket = 0;

const load = async (chat_id: string | null) => {
  const current = ++ticket;
  full_window_store.set({ chat_id, until: null });
  if (chat_id === null) {
    return;
  }
  try {
    const result = await api.invoke("turn:full_window", chat_id);
    if (current === ticket) {
      full_window_store.set(result);
    }
  } catch (error) {
    console.error(`[permissions] turn:full_window failed for chat ${chat_id}`, error);
  }
};

const receive = (update: FullWindow) => {
  if (full_window_store.get().chat_id !== update.chat_id) {
    return;
  }
  ticket += 1;
  full_window_store.set(update);
};

export const end_full_window = async (chat_id: string): Promise<ActionResult> => {
  try {
    await api.invoke("turn:end_full_window", chat_id);
    return { ok: true };
  } catch (error) {
    console.error(`[permissions] turn:end_full_window failed for chat ${chat_id}`, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

export const init_full_window = (): (() => void) => {
  const stops = [api.on("turn:full_window_changed", receive), on_active_chat((chat_id) => void load(chat_id))];
  return () => {
    for (const stop of stops) {
      stop();
    }
  };
};
