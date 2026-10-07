import type { ChatMeta, ChatSummary, Message } from "../../shared/chat.ts";

export type ChatBody = { summary: ChatSummary | null; messages: Message[] };

export type ChatDirs = { index_file: string; data_dir: string; search_dir: string };

export type ChatEvents = {
  changed: (meta: ChatMeta) => void;
  removed: (chat_id: string) => void;
  appended: (chat_id: string, message: Message) => void;
  truncated: (chat_id: string, message_id: string) => void;
};

export const metas = new Map<string, ChatMeta>();

export const bodies = new Map<string, ChatBody>();

export const refs = new Map<string, number>();

let dirs: ChatDirs | null = null;

let events: ChatEvents | null = null;

export const reset_chat_state = (next_dirs: ChatDirs, next_events: ChatEvents) => {
  metas.clear();
  bodies.clear();
  refs.clear();
  dirs = next_dirs;
  events = next_events;
};

export const chat_dirs = (): ChatDirs => {
  if (!dirs) {
    throw new Error("chats used before init_chats");
  }
  return dirs;
};

export const chat_events = (): ChatEvents => {
  if (!events) {
    throw new Error("chats used before init_chats");
  }
  return events;
};

export const sorted_metas = (): ChatMeta[] => [...metas.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
