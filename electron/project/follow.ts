import { project_chat_ids, update_meta } from "../chats/store.ts";
import { move_project_artifacts } from "../media/artifacts.ts";
import { memory_loaded, move_project_memories } from "../memory/store.ts";
import { find_project, get_settings, set_project_folder } from "../settings/store.ts";
import { error_code, error_text } from "../storage/coerce.ts";
import { find_renamed, read_folder_id } from "./folder.ts";

let chain: Promise<unknown> = Promise.resolve();

const serialize = <T>(work: () => Promise<T>): Promise<T> => {
  const run = chain.then(work);
  chain = Promise.allSettled([run]);
  return run;
};

const relocate = async (old_path: string, next_path: string, folder_id: string) => {
  await set_project_folder(old_path, { path: next_path, folder_id });
  for (const chat_id of project_chat_ids(old_path)) {
    await update_meta(chat_id, { project_path: next_path });
  }
  if (memory_loaded()) {
    await move_project_memories(old_path, next_path);
  }
  await move_project_artifacts(old_path, next_path);
  console.info(`[projects] ${old_path} was renamed to ${next_path}, its chats, memories and images moved along`);
};

const locate = async (project_path: string): Promise<string> => {
  const entry = find_project(project_path);
  if (!entry) {
    return project_path;
  }
  try {
    const folder_id = await read_folder_id(entry.path);
    if (folder_id !== entry.folder_id) {
      await set_project_folder(entry.path, { path: entry.path, folder_id });
    }
    return project_path;
  } catch (error) {
    if (error_code(error) !== "ENOENT") {
      throw error;
    }
  }
  if (!entry.folder_id) {
    console.warn(`[projects] ${entry.path} is missing and its folder id was never recorded, a renamed folder cannot be found`);
    return project_path;
  }
  const found = await find_renamed(entry.path, entry.folder_id);
  if (!found) {
    return project_path;
  }
  await relocate(entry.path, found, entry.folder_id);
  return found;
};

export const follow_project = (project_path: string): Promise<string> =>
  serialize(async () => {
    try {
      return await locate(project_path);
    } catch (error) {
      console.error(`[projects] checking the folder of project ${project_path} failed: ${error_text(error)}`);
      return project_path;
    }
  });

export const check_project_folders = async (): Promise<void> => {
  for (const entry of get_settings().projects) {
    await follow_project(entry.path);
  }
};
