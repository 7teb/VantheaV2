import fs from "node:fs/promises";
import path from "node:path";
import { chat_id_pattern } from "../chats/files.ts";
import { error_text, missing_path } from "../storage/coerce.ts";
import * as queue from "./queue.ts";
import { current_deps, inactive, mark_removed, paths_of } from "./state.ts";
import { forget_live } from "./summary.ts";
import { forget_chat } from "./turns.ts";

const remove_dir = (dir: string): Promise<void> => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

export const sweep_orphans = async (): Promise<number> => {
  const { root, chat_known } = current_deps();
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (error) {
    if (missing_path(error)) return 0;
    throw error;
  }
  let removed = 0;
  for (const name of names) {
    if (!chat_id_pattern.test(name) || (await chat_known(name))) continue;
    try {
      await remove_dir(path.join(root, name));
      removed += 1;
    } catch (error) {
      console.error(`[turn-diff] removing the snapshot folder of the deleted chat ${name} failed: ${error_text(error)}`);
    }
  }
  if (removed) console.info(`[turn-diff] removed the snapshot folders of ${removed} deleted chats`);
  return removed;
};

export const remove_chat = async (chat_id: string): Promise<void> => {
  if (inactive(chat_id)) return;
  mark_removed(chat_id);
  forget_chat(chat_id);
  forget_live(chat_id);
  await queue.stop_chat(chat_id, `chat ${chat_id} was deleted`);
  await remove_dir(paths_of(chat_id).dir);
};
