import fs from "node:fs/promises";
import path from "node:path";

export type StoragePaths = {
  user_data: string;
  root: string;
  settings: string;
  secrets: string;
  chats: string;
  chat_index: string;
  chat_data: string;
  chat_search: string;
  attachments: string;
  images: string;
  artifacts: string;
  snapshots: string;
  background: string;
  agents: string;
  memories: string;
  skills: string;
  workspaces: string;
  legacy_settings: string;
  legacy_artifacts: string;
  legacy_memories: string;
  legacy_skills: string;
};

const storage_paths_for = (user_data: string): StoragePaths => {
  const root = path.join(user_data, "v2");
  const chats = path.join(root, "chats");
  return {
    user_data,
    root,
    settings: path.join(root, "settings.json"),
    secrets: path.join(root, "secrets.json"),
    chats,
    chat_index: path.join(chats, "index.json"),
    chat_data: path.join(chats, "data"),
    chat_search: path.join(chats, "search"),
    attachments: path.join(root, "media", "attachments"),
    images: path.join(root, "media", "images"),
    artifacts: path.join(root, "artifacts.json"),
    snapshots: path.join(root, "snapshots"),
    background: path.join(root, "background.json"),
    agents: path.join(root, "agents"),
    memories: path.join(root, "memories.json"),
    skills: path.join(root, "skills"),
    workspaces: path.join(root, "workspaces"),
    legacy_settings: path.join(user_data, "settings.json"),
    legacy_artifacts: path.join(user_data, "artifacts.json"),
    legacy_memories: path.join(user_data, "memories-v2.json"),
    legacy_skills: path.join(user_data, "skills"),
  };
};

export const storage_dirs = (paths: StoragePaths): string[] => [
  paths.root,
  paths.chats,
  paths.chat_data,
  paths.chat_search,
  paths.attachments,
  paths.images,
  paths.snapshots,
  paths.skills,
  paths.agents,
];

let current: StoragePaths | null = null;

export const set_storage_root = (user_data: string): StoragePaths => {
  current = storage_paths_for(user_data);
  return current;
};

export const storage_paths = (): StoragePaths => {
  if (!current) {
    throw new Error("storage paths requested before init_persistence set the storage root");
  }
  return current;
};

export const ensure_storage_dirs = async (paths: StoragePaths) => {
  for (const dir of storage_dirs(paths)) {
    await fs.mkdir(dir, { recursive: true });
  }
};

export const path_key = (value: string): string => value.trim().replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();

export const folder_name = (value: string): string => {
  const parts = value.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts.at(-1) || value;
};
