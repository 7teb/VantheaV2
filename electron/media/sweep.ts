import fs from "node:fs/promises";
import { chat_id_pattern, read_chat_file } from "../chats/files.ts";
import { attachment_ids, is_held, is_referenced } from "../chats/refs.ts";
import { chat_dirs } from "../chats/state.ts";
import { delete_attachment, list_media } from "./files.ts";
import { session_upload_ids } from "./uploads.ts";

const chat_file_ids = async (): Promise<string[]> =>
  (await fs.readdir(chat_dirs().data_dir)).flatMap((name) => {
    const chat_id = name.endsWith(".vxc") ? name.slice(0, -".vxc".length) : "";
    return chat_id_pattern.test(chat_id) ? [chat_id] : [];
  });

const stored_references = async (): Promise<Set<string> | null> => {
  const ids = new Set<string>();
  for (const chat_id of await chat_file_ids()) {
    try {
      const stored = await read_chat_file(chat_id);
      if (!stored) {
        console.error(`[media] attachment sweep stopped without deleting anything: chat ${chat_id} could not be read`);
        return null;
      }
      for (const id of attachment_ids(stored.body.messages)) {
        ids.add(id);
      }
    } catch (error) {
      console.error(`[media] attachment sweep stopped without deleting anything: reading chat ${chat_id} failed:`, error);
      return null;
    }
  }
  return ids;
};

export const sweep_attachments = async (): Promise<number> => {
  const started = Date.now();
  const referenced = await stored_references();
  if (!referenced) {
    return 0;
  }
  const session = session_upload_ids();
  let removed = 0;
  for (const file of await list_media("attachment")) {
    if (file.modified_ms >= started || referenced.has(file.id) || session.has(file.id) || is_held(file.id) || is_referenced(file.id)) {
      continue;
    }
    try {
      await delete_attachment(file.id);
      removed += 1;
    } catch (error) {
      console.error(`[media] attachment sweep could not delete ${file.id}:`, error);
    }
  }
  console.info(`[media] attachment sweep removed ${removed} unreferenced files`);
  return removed;
};
