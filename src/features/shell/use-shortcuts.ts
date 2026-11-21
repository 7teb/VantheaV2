import { useEffect } from "react";
import { remote_client } from "../../api/bridge.ts";
import { close_top_layer } from "../../components/layers.ts";
import { chat_busy } from "../../state/chat-busy.ts";
import { chats_store } from "../../state/chats.ts";
import { stop_turn } from "../../state/composer.ts";
import { cancel_dictation, dictation_cancellable, dictation_store } from "../../state/dictation.ts";
import { choose_project } from "../../state/projects.ts";
import { settings_store } from "../../state/settings.ts";
import { open_chat, open_search, open_settings, start_new_chat, toggle_dock, toggle_sidebar, ui_store } from "../../state/ui.ts";
import { toggle_fullscreen, zoom_window } from "../../state/window.ts";
import { build_sidebar, sidebar_order } from "../sidebar/sidebar-model.ts";
import { toggle_background_dock } from "./docks.ts";
import { escape_fallback } from "./escape-fallback.ts";
import { run_bound } from "./shortcut-bindings.ts";
import { focus_target, yields_to_focus } from "./shortcut-targets.ts";
import { match_shortcut, shortcut_matches, type AppShortcutId } from "./shortcuts.ts";

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

const always = (run: () => void) => () => {
  run();
  return true;
};

const pc_only = (run: () => void) => () => {
  if (remote_client) {
    return false;
  }
  run();
  return true;
};

const bound = (id: AppShortcutId) => () => run_bound(id);

const actions: Record<AppShortcutId, () => boolean> = {
  new_chat: always(() => start_new_chat(ui_store.get().project_path)),
  open_project: pc_only(() => {
    choose_project().catch((error) => console.error("[shortcuts] choosing a project failed", error));
  }),
  toggle_sidebar: always(toggle_sidebar),
  search: always(open_search),
  settings: always(() => open_settings()),
  prev_chat: always(() => step_chat(-1)),
  next_chat: always(() => step_chat(1)),
  zoom_in: pc_only(() => zoom_window(1)),
  zoom_out: pc_only(() => zoom_window(-1)),
  zoom_reset: pc_only(() => zoom_window(0)),
  fullscreen: pc_only(toggle_fullscreen),
  close_layer: close_top_layer,
  focus_composer: bound("focus_composer"),
  toggle_terminal: always(() => toggle_dock("terminal")),
  toggle_files: always(() => toggle_dock("files")),
  toggle_browser: pc_only(() => toggle_dock("browser")),
  toggle_tasks: always(toggle_background_dock),
  copy_answer: bound("copy_answer"),
  dictate: bound("dictate"),
  toggle_plan: bound("toggle_plan"),
};

const target_of = (event: KeyboardEvent) => focus_target(event.target instanceof Element ? event.target : null);

const run_escape_fallback = (event: KeyboardEvent) => {
  const chat_id = ui_store.get().active_chat_id;
  const fallback = escape_fallback({
    consumed: event.defaultPrevented,
    focus: target_of(event),
    dictating: dictation_cancellable(dictation_store.get()),
    busy: chat_id !== null && chat_busy(chat_id),
  });
  if (fallback === null) {
    return;
  }
  event.preventDefault();
  if (fallback === "cancel_dictation") {
    cancel_dictation();
    return;
  }
  if (chat_id !== null) {
    void stop_turn(chat_id);
  }
};

export const use_shortcuts = () => {
  useEffect(() => {
    const on_key_down = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) {
        return;
      }
      const id = match_shortcut(event);
      if (id === null || yields_to_focus(id, target_of(event)) || !actions[id]()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    const on_key_settled = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || !shortcut_matches("stop_turn", event)) {
        return;
      }
      run_escape_fallback(event);
    };
    window.addEventListener("keydown", on_key_down, true);
    window.addEventListener("keydown", on_key_settled);
    return () => {
      window.removeEventListener("keydown", on_key_down, true);
      window.removeEventListener("keydown", on_key_settled);
    };
  }, []);
};
