import type { ChatMeta } from "../../shared/chat.ts";
import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";
import { start_new_chat, ui_store } from "./ui.ts";

export type ChatsState = { status: "loading" | "ready" | "failed"; list: ChatMeta[] };

type ChatChange = { kind: "changed"; meta: ChatMeta } | { kind: "removed"; chat_id: string };

export const chats_store = create_store<ChatsState>({ status: "loading", list: [] });

const apply_change = (list: ChatMeta[], change: ChatChange): ChatMeta[] => {
  if (change.kind === "removed") {
    return list.filter((chat) => chat.id !== change.chat_id);
  }
  const index = list.findIndex((chat) => chat.id === change.meta.id);
  if (index === -1) {
    return [change.meta, ...list];
  }
  return list.map((chat, position) => (position === index ? change.meta : chat));
};

const set_list = (list: ChatMeta[]) => {
  chats_store.set({ status: "ready", list });
  const active = ui_store.get().active_chat_id;
  if (active === null) {
    return;
  }
  const chat = list.find((entry) => entry.id === active);
  if (!chat) {
    start_new_chat(ui_store.get().project_path);
    return;
  }
  if (ui_store.get().project_path !== chat.project_path) {
    ui_store.update((state) => ({ ...state, project_path: chat.project_path }));
  }
};

const early: ChatChange[] = [];

const receive = (change: ChatChange) => {
  const current = chats_store.get();
  if (current.status !== "ready") {
    early.push(change);
    return;
  }
  set_list(apply_change(current.list, change));
};

export const load_chats = async () => {
  chats_store.set({ status: "loading", list: chats_store.get().list });
  try {
    const list = await api.invoke("chats:list");
    set_list(early.splice(0).reduce(apply_change, list));
  } catch (error) {
    console.error("[chats] chats:list failed", error);
    chats_store.set({ status: "failed", list: [] });
  }
};

export const init_chats = (): (() => void) => {
  void load_chats();
  const stop_changed = api.on("chats:changed", (meta) => receive({ kind: "changed", meta }));
  const stop_removed = api.on("chats:removed", ({ chat_id }) => receive({ kind: "removed", chat_id }));
  return () => {
    stop_changed();
    stop_removed();
  };
};

export const rename_chat = async (chat_id: string, title: string) => {
  receive({ kind: "changed", meta: await api.invoke("chats:update", chat_id, { title }) });
};

export const set_chat_pinned = async (chat_id: string, pinned: boolean) => {
  receive({ kind: "changed", meta: await api.invoke("chats:update", chat_id, { pinned }) });
};

export const delete_chat = async (chat_id: string) => {
  await api.invoke("chats:delete", chat_id);
  receive({ kind: "removed", chat_id });
};
