import fs from "node:fs/promises";
import path from "node:path";
import type { ChatMeta } from "../../shared/chat.ts";
import { follow_project } from "../project/follow.ts";
import { storage_paths } from "../storage/paths.ts";
import { legacy_workspace } from "./legacy/workspace.ts";

const workspace_dir = (chat: ChatMeta): string => {
  const paths = storage_paths();
  if (!chat.workspace) {
    return path.join(paths.workspaces, chat.id);
  }
  if (path.isAbsolute(chat.workspace)) {
    return chat.workspace;
  }
  return legacy_workspace(paths.user_data, "", chat.workspace);
};

export const chat_root = async (chat: ChatMeta): Promise<string> => {
  if (chat.project_path) {
    return follow_project(chat.project_path);
  }
  const dir = workspace_dir(chat);
  await fs.mkdir(dir, { recursive: true });
  return dir;
};
