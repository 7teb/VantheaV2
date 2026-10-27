import type { TurnSpan } from "../../shared/turn-diff.ts";
import { newest_span } from "../../shared/turn-span.ts";
import { api } from "../api/bridge.ts";
import { chat_messages } from "./chat-view-reduce.ts";
import { chat_view_store } from "./chat-view.ts";
import { create_store } from "./create-store.ts";
import { files_store, set_tree_open, show_file } from "./files.ts";
import { git_store, git_ui_of, set_surface, type GitSurface } from "./git.ts";
import { toggle_dock, ui_store } from "./ui.ts";

export type DiffRange = "turn" | "chat";

export type TurnDiffUi = { range: DiffRange; span: TurnSpan | null; pinned_with: string | null; path: string | null };

export type TurnDiffUiState = Record<string, TurnDiffUi>;

const default_ui: TurnDiffUi = { range: "turn", span: null, pinned_with: null, path: null };

export const turn_diff_ui_store = create_store<TurnDiffUiState>({});

export const turn_diff_ui_of = (state: TurnDiffUiState, key: string): TurnDiffUi => state[key] ?? default_ui;

const patch_ui = (change: (ui: TurnDiffUi) => TurnDiffUi) => {
  const key = files_store.get().key;
  turn_diff_ui_store.update((state) => {
    const current = turn_diff_ui_of(state, key);
    const next = change(current);
    return next === current ? state : { ...state, [key]: next };
  });
};

export const open_turn_diff = (span: TurnSpan, path: string | null = null) => {
  if (ui_store.get().dock.kind !== "files") {
    toggle_dock("files");
  }
  set_surface("diff");
  const pinned_with = newest_span(chat_messages(chat_view_store.get(), files_store.get().key))?.from_id ?? null;
  patch_ui(() => ({ range: "turn", span, pinned_with, path }));
  if (path === null) {
    set_tree_open(true);
  }
};

export const show_changed_file = (path: string) => {
  if (git_ui_of(git_store.get(), files_store.get().key).surface === "diff") {
    set_surface("files");
  }
  show_file(path);
};

export const pick_surface = (surface: GitSurface) => {
  if (surface === "diff") {
    patch_ui((ui) => (ui.span === null ? ui : { ...ui, span: null, pinned_with: null }));
  }
  set_surface(surface);
};

export const set_diff_range = (range: DiffRange) => patch_ui((ui) => (ui.range === range ? ui : { ...ui, range }));

export const select_diff_path = (path: string) => patch_ui((ui) => (ui.path === path ? ui : { ...ui, path }));

export const init_turn_diff_ui = (): (() => void) =>
  api.on("chats:removed", ({ chat_id }) =>
    turn_diff_ui_store.update((state) => (state[chat_id] ? Object.fromEntries(Object.entries(state).filter(([key]) => key !== chat_id)) : state)),
  );
