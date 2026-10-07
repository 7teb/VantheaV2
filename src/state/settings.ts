import type { ProjectEntry, SecretName, SettingsPatch, SettingsView } from "../../shared/settings.ts";
import { api } from "../api/bridge.ts";
import { set_language } from "../i18n/index.ts";
import { create_store } from "./create-store.ts";
import { apply_settings_patch } from "./settings-patch.ts";
import { ui_store } from "./ui.ts";

export const settings_store = create_store<SettingsView | null>(null);

let latest_request = 0;
let pending_requests = 0;

export const reload_settings = async () => {
  try {
    settings_store.set(await api.invoke("settings:get"));
  } catch (error) {
    console.error("[settings] settings:get failed", error);
  }
};

export const update_settings = async (patch: SettingsPatch) => {
  const current = settings_store.get();
  if (current) {
    settings_store.set(apply_settings_patch(current, patch));
  }
  const request = ++latest_request;
  pending_requests += 1;
  try {
    const view = await api.invoke("settings:update", patch);
    if (request === latest_request) {
      settings_store.set(view);
    }
  } catch (error) {
    console.error("[settings] settings:update failed for patch", patch, error);
    if (request === latest_request) {
      await reload_settings();
    }
  } finally {
    pending_requests -= 1;
  }
};

export const set_secret = async (name: SecretName, value: string) => {
  settings_store.set(await api.invoke("settings:set_secret", name, value));
};

const follow_moved_project = (before: ProjectEntry[], after: ProjectEntry[]) => {
  const selected = ui_store.get().project_path;
  const old = before.find((entry) => entry.path === selected);
  if (!old?.folder_id || after.some((entry) => entry.path === selected)) {
    return;
  }
  const moved = after.find((entry) => entry.folder_id === old.folder_id);
  if (moved) {
    ui_store.update((state) => ({ ...state, project_path: moved.path }));
  }
};

export const init_settings = (): (() => void) => {
  void reload_settings();
  let projects = settings_store.get()?.projects ?? [];
  const stop_language = settings_store.subscribe(() => {
    const view = settings_store.get();
    if (view) {
      set_language(view.language);
      follow_moved_project(projects, view.projects);
      projects = view.projects;
    }
  });
  const stop_changes = api.on("settings:changed", (view) => {
    if (pending_requests === 0) {
      settings_store.set(view);
    }
  });
  return () => {
    stop_language();
    stop_changes();
  };
};
