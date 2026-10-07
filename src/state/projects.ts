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

export const choose_project = async () => {
  await adopt(await api.invoke("projects:choose"));
};

export const create_project = async () => {
  await adopt(await api.invoke("projects:create"));
};

export const rename_project = async (path: string, name: string) => {
  settings_store.set(await api.invoke("projects:update", path, { name }));
};

export const set_project_pinned = async (path: string, pinned: boolean) => {
  settings_store.set(await api.invoke("projects:update", path, { pinned }));
};

export const remove_project = async (path: string) => {
  settings_store.set(await api.invoke("projects:remove", path));
  if (ui_store.get().project_path === path && ui_store.get().active_chat_id === null) {
    start_new_chat("");
  }
};
