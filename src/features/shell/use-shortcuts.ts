import { useEffect } from "react";
import { close_top_layer } from "../../components/layers.ts";
import { chats_store } from "../../state/chats.ts";
import { choose_project } from "../../state/projects.ts";
import { settings_store } from "../../state/settings.ts";
import { open_chat, open_search, open_settings, start_new_chat, toggle_sidebar, ui_store } from "../../state/ui.ts";
import { toggle_fullscreen, zoom_window } from "../../state/window.ts";
import { build_sidebar, sidebar_order } from "../sidebar/sidebar-model.ts";
import { focus_target, yields_to_focus } from "./shortcut-targets.ts";
import { match_shortcut, type ShortcutId } from "./shortcuts.ts";

const step_chat = (direction: 1 | -1) => {
  const ui = ui_store.get();
  const order = sidebar_order(build_sidebar(chats_store.get().list, settings_store.get()?.projects ?? []), ui.collapsed_projects);
  if (order.length === 0) {
    return;
  }
  const index = order.findIndex((chat) => chat.id === ui.active_chat_id);
  const next = order[index === -1 ? 0 : (index + direction + order.length) % order.length];
  open_chat(next.id, next.project_path);
};

const actions: Record<ShortcutId, () => boolean> = {
  new_chat: () => {
    start_new_chat(ui_store.get().project_path);
    return true;
  },
  open_project: () => {
    choose_project().catch((error) => console.error("[shortcuts] choosing a project failed", error));
    return true;
  },
  toggle_sidebar: () => {
    toggle_sidebar();
    return true;
  },
  search: () => {
    open_search();
    return true;
  },
  settings: () => {
    open_settings();
    return true;
  },
  prev_chat: () => {
    step_chat(-1);
    return true;
  },
  next_chat: () => {
    step_chat(1);
    return true;
  },
  zoom_in: () => {
    zoom_window(1);
    return true;
  },
  zoom_out: () => {
    zoom_window(-1);
    return true;
  },
  zoom_reset: () => {
    zoom_window(0);
    return true;
  },
  fullscreen: () => {
    toggle_fullscreen();
    return true;
  },
  close_layer: close_top_layer,
};

export const use_shortcuts = () => {
  useEffect(() => {
    const on_key_down = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) {
        return;
      }
      const id = match_shortcut(event);
      if (id === null || yields_to_focus(id, focus_target(event.target instanceof Element ? event.target : null)) || !actions[id]()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", on_key_down, true);
    return () => window.removeEventListener("keydown", on_key_down, true);
  }, []);
};
