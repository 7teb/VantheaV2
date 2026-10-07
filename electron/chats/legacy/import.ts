import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { brotliDecompress } from "node:zlib";
import type { Chat } from "../../../shared/chat.ts";
import { import_legacy_media } from "../../media/legacy.ts";
import { as_array, as_record, as_string } from "../../storage/coerce.ts";
import { read_json } from "../../storage/json-file.ts";
import { convert_legacy_chat } from "./message.ts";

const decompress = promisify(brotliDecompress);

export const legacy_chat_file = (store_dir: string, chat_id: string) =>
  path.join(store_dir, "data-v2", `${createHash("sha256").update(chat_id).digest("hex")}.vxchat`);

const read_legacy_chat = async (store_dir: string, chat_id: string): Promise<unknown> => {
  const packed = await fs.readFile(legacy_chat_file(store_dir, chat_id));
  return JSON.parse((await decompress(packed)).toString("utf8"));
};

export const import_legacy_chats = async (legacy_root: string, adopt: (chat: Chat) => Promise<void>): Promise<number> => {
  const store_dir = path.join(legacy_root, "chat-store");
  const index = await read_json(path.join(store_dir, "index.json"));
  if (index.status === "missing") {
    return 0;
  }
  if (index.status === "corrupt") {
    console.error(`[chats] legacy chat index in ${store_dir} is not valid JSON (${index.error}), no chats imported`);
    return 0;
  }
  const entries = as_array(as_record(index.value).chats);
  const taken = new Set<string>();
  const now = new Date().toISOString();
  let imported = 0;
  for (const entry of entries) {
    const legacy_id = as_string(as_record(entry).id);
    if (!legacy_id) {
      continue;
    }
    try {
      const { chat, media } = convert_legacy_chat(await read_legacy_chat(store_dir, legacy_id), now, legacy_root);
      if (taken.has(chat.id)) {
        console.error(`[chats] legacy chat ${legacy_id} appears twice in the legacy index, the duplicate was skipped`);
        continue;
      }
      for (const ref of media) {
        await import_legacy_media(legacy_root, ref);
      }
      await adopt(chat);
      taken.add(chat.id);
      imported += 1;
    } catch (error) {
      console.error(`[chats] legacy chat ${legacy_id} could not be imported and was skipped:`, error);
    }
  }
  console.info(`[chats] imported ${imported} of ${entries.length} legacy chats`);
  return imported;
};
