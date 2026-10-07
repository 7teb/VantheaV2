import { create_store } from "./create-store.ts";

export type DockKind = "terminal" | "browser" | "background" | "agents" | "artifacts";

export type DockState = { kind: DockKind | null; width: number };

export type UiState = {
  sidebar_collapsed: boolean;
  active_chat_id: string | null;
  project_path: string;
  dock: DockState;
  settings_open: boolean;
  settings_section: string;
  search_open: boolean;
  collapsed_projects: string[];
};

export const dock_min_width = 320;

const active_chat_key = "vx:active-chat";
const collapsed_projects_key = "vx:collapsed-projects";

const read_storage = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.error(`[ui] reading ${key} from localStorage failed`, error);
    return null;
  }
};

const write_storage = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, value);
  } catch (error) {
    console.error(`[ui] writing ${key} to localStorage failed`, error);
  }
};

const remembered_collapsed_projects = (): string[] => {
  const raw = read_storage(collapsed_projects_key);
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch (error) {
    console.error(`[ui] parsing ${collapsed_projects_key} failed for value`, raw, error);
    return [];
  }
};

export const max_dock_width = () =>Math.max(dock_min_width, Math.round(window.innerWidth * 0.7));

export const clamp_dock_width = (width: number) => Math.min(max_dock_width(), Math.max(dock_min_width, Math.round(width)));

export const ui_store = create_store<UiState>({
  sidebar_collapsed: false,
  active_chat_id: read_storage(active_chat_key),
  project_path: "",
  dock: { kind: null, width: clamp_dock_width(window.innerWidth * 0.42) },
  settings_open: false,
  settings_section: "general",
  search_open: false,
  collapsed_projects: remembered_collapsed_projects(),
});

export const set_sidebar_collapsed = (collapsed: boolean) => ui_store.update((state) => ({ ...state, sidebar_collapsed: collapsed }));

export const toggle_sidebar = () => set_sidebar_collapsed(!ui_store.get().sidebar_collapsed);

export const open_chat = (chat_id: string, project_path: string) => {
  write_storage(active_chat_key, chat_id);
  ui_store.update((state) => ({ ...state, active_chat_id: chat_id, project_path, settings_open: false, search_open: false }));
};

export const start_new_chat = (project_path: string) => {
  write_storage(active_chat_key, null);
  ui_store.update((state) => ({ ...state, active_chat_id: null, project_path, settings_open: false, search_open: false }));
};

export const toggle_dock = (kind: DockKind) =>
  ui_store.update((state) => ({ ...state, dock: { ...state.dock, kind: state.dock.kind === kind ? null : kind } }));

export const close_dock = () => ui_store.update((state) => ({ ...state, dock: { ...state.dock, kind: null } }));

export const set_dock_width = (width: number) =>
  ui_store.update((state) => ({ ...state, dock: { ...state.dock, width: clamp_dock_width(width) } }));

export const open_settings = (section?: string) =>
  ui_store.update((state) => ({ ...state, settings_open: true, search_open: false, settings_section: section ?? state.settings_section }));

export const select_settings_section = (section: string) => ui_store.update((state) => ({ ...state, settings_section: section }));

export const close_settings = () => ui_store.update((state) => ({ ...state, settings_open: false }));

export const open_search = () => ui_store.update((state) => ({ ...state, search_open: true }));

export const close_search = () => ui_store.update((state) => ({ ...state, search_open: false }));

export const toggle_project_collapsed = (path: string) => {
  const current = ui_store.get().collapsed_projects;
  const next = current.includes(path) ? current.filter((entry) => entry !== path) : [...current, path];
  write_storage(collapsed_projects_key, JSON.stringify(next));
  ui_store.update((state) => ({ ...state, collapsed_projects: next }));
};
