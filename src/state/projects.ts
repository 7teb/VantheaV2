import type { ProjectEntry } from "../../shared/settings.ts";
import { api } from "../api/bridge.ts";
import { reload_settings, settings_store } from "./settings.ts";
import { start_new_chat, ui_store } from "./ui.ts";

const adopt = async (entry: ProjectEntry | null) => {
  if (!entry) {
    return;
  }
  start_new_chat(entry.path);
  await reload_settings();
};

export const choose_project = async (): Promise<ProjectEntry | null> => {
  const entry = await api.invoke("projects:choose");
  await adopt(entry);
  return entry;
};

export const pick_project_folder = () => api.invoke("projects:pick_folder");

export const create_project = async (name: string, folder: string | null) => {
  await adopt(await api.invoke("projects:create", { name, folder }));
};

export const rename_project = async (path: string, name: string) => {
  settings_store.set(await api.invoke("projects:update", path, { name }));
};

export const set_project_pinned = async (path: string, pinned: boolean) => {
  settings_store.set(await api.invoke("projects:update", path, { pinned }));
};

export const remove_all_projects = async () => {
  settings_store.set(await api.invoke("projects:remove_all"));
};

export const remove_project = async (path: string) => {
  settings_store.set(await api.invoke("projects:remove", path));
  if (ui_store.get().project_path === path && ui_store.get().active_chat_id === null) {
    start_new_chat("");
  }
};
