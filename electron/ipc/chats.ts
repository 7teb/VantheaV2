import { create_chat, delete_chat, fork_chat, get_chat, list_chats, search_chats, update_meta, type MetaPatch } from "../chats/store.ts";
import { optional_boolean, optional_string, require_record, require_string } from "../storage/coerce.ts";
import { handle } from "./handle.ts";

const chat_id = (value: unknown) => require_string(value, "chat id", 200);

const meta_patch = (value: unknown): MetaPatch => {
  const raw = require_record(value, "chat patch");
  return { title: optional_string(raw, "title", "chat title"), pinned: optional_boolean(raw, "pinned", "chat pinned") };
};

export const register_chats_ipc = () => {
  handle("chats:list", () => list_chats());
  handle("chats:get", (id) => get_chat(chat_id(id)));
  handle("chats:create", (project_path) => create_chat(require_string(project_path, "project path", 2000)));
  handle("chats:update", (id, patch) => update_meta(chat_id(id), meta_patch(patch)));
  handle("chats:delete", (id) => delete_chat(chat_id(id)));
  handle("chats:fork", (id, message_id) => fork_chat(chat_id(id), require_string(message_id, "message id", 200)));
  handle("chats:search", (query) => search_chats(require_string(query, "search query", 500)));
};
