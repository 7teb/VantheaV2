import fs from "node:fs/promises";
import path from "node:path";
import type { ChatMeta, ChatWorktree } from "../../shared/chat.ts";
import { entry_kind } from "../git/repo.ts";
import { follow_project } from "../project/follow.ts";
import { storage_paths } from "../storage/paths.ts";
import { legacy_workspace } from "./legacy/workspace.ts";
import { chat_meta } from "./store.ts";

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

export const worktree_dir = (worktree: ChatWorktree): string => (worktree.prefix ? path.join(worktree.path, ...worktree.prefix.split("/")) : worktree.path);

export const worktree_missing = (dir: string): Error =>
  Object.assign(new Error(`The worktree folder of this chat is missing: ${dir}. Restore it from the Files panel.`), { worktree_missing: true });

export const is_worktree_missing = (error: unknown): boolean => error instanceof Error && "worktree_missing" in error && error.worktree_missing === true;

export const chat_home = async (chat: ChatMeta): Promise<string> => {
  if (chat.project_path) {
    return follow_project(chat.project_path);
  }
  const dir = workspace_dir(chat);
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

export const chat_home_of = async (chat_id: string): Promise<string> => {
  const chat = chat_meta(chat_id);
  if (!chat) {
    throw new Error(`chat ${chat_id} not found`);
  }
  return chat_home(chat);
};

export const chat_root = async (chat: ChatMeta): Promise<string> => {
  if (!chat.worktree) {
    return chat_home(chat);
  }
  await follow_project(chat.project_path);
  const dir = worktree_dir(chat.worktree);
  if ((await entry_kind(dir)) !== "dir") {
    throw worktree_missing(dir);
  }
  return dir;
};

export const instruction_fallback = async (chat_id: string): Promise<string | null> => {
  const chat = chat_meta(chat_id);
  return chat?.worktree ? chat_home(chat) : null;
};
