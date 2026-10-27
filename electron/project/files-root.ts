import type { FilesRoot, FilesScope } from "../../shared/ipc/files.ts";
import { chat_meta } from "../chats/store.ts";
import { chat_root, is_worktree_missing, worktree_dir, worktree_missing } from "../chats/workspace.ts";
import { find_project } from "../settings/store.ts";
import { require_record, require_string } from "../storage/coerce.ts";
import { folder_name } from "../storage/paths.ts";
import { known_project_dir } from "./follow.ts";

export const parse_scope = (value: unknown): FilesScope => {
  const raw = require_record(value, "files scope");
  return {
    chat_id: raw.chat_id === null ? null : require_string(raw.chat_id, "chat id", 200),
    project_path: require_string(raw.project_path, "project path", 2000),
  };
};

const project_root = (dir: string, project_path: string): FilesRoot => ({
  path: dir,
  name: (find_project(project_path) ?? find_project(dir))?.name ?? folder_name(dir),
  kind: "project",
});

export const files_root = async (scope: FilesScope): Promise<FilesRoot | null> => {
  if (scope.chat_id === null) {
    return scope.project_path ? project_root(await known_project_dir(scope.project_path), scope.project_path) : null;
  }
  const chat = chat_meta(scope.chat_id);
  if (!chat) {
    throw new Error(`chat ${scope.chat_id} does not exist`);
  }
  if (!chat.worktree) {
    const dir = await chat_root(chat);
    return chat.project_path ? project_root(dir, chat.project_path) : { path: dir, name: folder_name(dir), kind: "workspace" };
  }
  try {
    return { ...project_root(await chat_root(chat), chat.project_path), worktree: { branch: chat.worktree.branch, missing: false } };
  } catch (error) {
    if (!is_worktree_missing(error)) {
      throw error;
    }
    return { ...project_root(worktree_dir(chat.worktree), chat.project_path), worktree: { branch: chat.worktree.branch, missing: true } };
  }
};

export const require_root = async (scope: FilesScope): Promise<string> => {
  const root = await files_root(scope);
  if (!root) {
    throw new Error("no project folder is open, there is nothing to browse");
  }
  if (root.worktree?.missing) {
    throw worktree_missing(root.path);
  }
  return root.path;
};
