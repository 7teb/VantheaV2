import fs from "node:fs/promises";
import type { Chat } from "../../shared/chat.ts";
import { keep_corrupt, read_json } from "../storage/json-file.ts";
import { chat_id_pattern, load_index, read_chat_file } from "./files.ts";
import { import_legacy_chats } from "./legacy/import.ts";
import { persist_index, write_chat_direct } from "./persist.ts";
import { attachment_ids, change_refs } from "./refs.ts";
import { metas, type ChatDirs } from "./state.ts";

const adopt_chat = async (chat: Chat) => {
  const { summary, messages, ...meta } = chat;
  metas.set(meta.id, { ...meta, streaming: false });
  change_refs(new Set(), attachment_ids(messages));
  await write_chat_direct(meta, { summary, messages });
};

const rebuild_index = async (dirs: ChatDirs) => {
  let rebuilt = 0;
  for (const name of await fs.readdir(dirs.data_dir)) {
    const chat_id = name.endsWith(".vxc") ? name.slice(0, -".vxc".length) : "";
    if (!chat_id_pattern.test(chat_id)) {
      continue;
    }
    try {
      const stored = await read_chat_file(chat_id);
      if (!stored) {
        continue;
      }
      metas.set(chat_id, { ...stored.meta, message_count: stored.body.messages.length });
      change_refs(new Set(), attachment_ids(stored.body.messages));
      rebuilt += 1;
    } catch (error) {
      console.error(`[chats] chat file ${name} could not be read while rebuilding the index:`, error);
    }
  }
  console.info(`[chats] rebuilt the chat index from ${rebuilt} chat files`);
};

export const load_chat_index = async (dirs: ChatDirs, legacy_root: string) => {
  await fs.mkdir(dirs.data_dir, { recursive: true });
  await fs.mkdir(dirs.search_dir, { recursive: true });
  const stored = await read_json(dirs.index_file);
  if (stored.status === "ok") {
    load_index(stored.value);
    return;
  }
  if (stored.status === "corrupt") {
    console.error(`[chats] ${dirs.index_file} is not valid JSON (${stored.error}), keeping a copy at ${await keep_corrupt(dirs.index_file)}`);
    await rebuild_index(dirs);
  } else {
    await import_legacy_chats(legacy_root, adopt_chat);
  }
  await persist_index();
};
