import { draft_browser_chat } from "../../shared/ipc/browser.ts";
import type { ModelChoice } from "../../shared/models.ts";
import { adopt_tabs } from "../browser/tabs.ts";
import { parse_choice } from "../chats/files.ts";
import { archive_all_chats, create_chat, delete_all_chats, delete_chat, fork_chat, get_chat, list_chats, search_chats, update_meta, type MetaPatch } from "../chats/store.ts";
import { optional_boolean, optional_string, require_record, require_string } from "../storage/coerce.ts";
import { turn_diffs } from "../turn-diff/index.ts";
import { handle } from "./handle.ts";

const chat_id = (value: unknown) => require_string(value, "chat id", 200);

const choice_patch = (value: unknown): ModelChoice | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const choice = parse_choice(value);
  if (!choice) {
    throw new Error("chat model choice needs a model id");
  }
  return choice;
};

const meta_patch = (value: unknown): MetaPatch => {
  const raw = require_record(value, "chat patch");
  return {
    title: optional_string(raw, "title", "chat title"),
    pinned: optional_boolean(raw, "pinned", "chat pinned"),
    archived: optional_boolean(raw, "archived", "chat archived"),
    choice: choice_patch(raw.choice),
  };
};

export const register_chats_ipc = () => {
  handle("chats:list", () => list_chats());
  handle("chats:get", (id) => get_chat(chat_id(id)));
  handle("chats:create", async (project_path) => {
    const meta = await create_chat(require_string(project_path, "project path", 2000));
    adopt_tabs(draft_browser_chat, meta.id);
    return meta;
  });
  handle("chats:update", (id, patch) => update_meta(chat_id(id), meta_patch(patch)));
  handle("chats:delete", (id) => delete_chat(chat_id(id)));
  handle("chats:archive_all", () => archive_all_chats());
  handle("chats:delete_all", () => delete_all_chats());
  handle("chats:fork", async (id, message_id) => {
    const source = chat_id(id);
    const meta = await fork_chat(source, require_string(message_id, "message id", 200));
    turn_diffs.fork(source, meta.id);
    return meta;
  });
  handle("chats:search", (query) => search_chats(require_string(query, "search query", 500)));
};
