import type { GitEntry, GitRepoView, GitView } from "../../shared/git-view.ts";
import { git_decorations, type GitDecorations } from "../../shared/git/decorations.ts";
import type { GitChange } from "../../shared/ipc/git.ts";
import { is_secret_path } from "../../shared/secret-path.ts";
import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";
import { files_store, shown_view, type FilesState } from "./files.ts";

export type GitSurface = "files" | "changes" | "history" | "diff";

export type ViewerMode = "file" | "diff";

export type CommitFileOpen = { hash: string; path: string };

export type GitUi = { surface: GitSurface; modes: Record<string, ViewerMode>; commit: string | null; commit_file: CommitFileOpen | null; history_top: number };

export type GitState = { views: Record<string, GitView>; ui: Record<string, GitUi>; readable: string | null };

const none: GitView = { kind: "none" };

const default_ui: GitUi = { surface: "files", modes: {}, commit: null, commit_file: null, history_top: 0 };

const no_entries: GitEntry[] = [];

export const git_store = create_store<GitState>({ views: {}, ui: {}, readable: null });

export const shown_root = (state: FilesState): string | null => shown_view(state).root.root?.path ?? null;

export const git_view_of = (state: GitState, root: string | null): GitView => (root === null ? none : (state.views[root] ?? none));

export const git_ui_of = (state: GitState, key: string): GitUi => state.ui[key] ?? default_ui;

const listed = new WeakMap<GitView, GitEntry[]>();

export const changed_entries = (view: GitView): GitEntry[] => {
  if (view.kind !== "repo") {
    return no_entries;
  }
  const cached = listed.get(view);
  if (cached) {
    return cached;
  }
  const entries = view.entries.filter((entry) => entry.status !== "ignored");
  listed.set(view, entries);
  return entries;
};

const left_out_of_commit = (view: GitRepoView, entry: GitEntry): boolean => {
  if (entry.nested_repo) return true;
  if (entry.status !== "untracked" && entry.status !== "added") return false;
  const { prefix } = view.repo;
  return is_secret_path(prefix && entry.path.startsWith(`${prefix}/`) ? entry.path.slice(prefix.length + 1) : entry.path);
};

export const commit_count = (view: GitRepoView): number => changed_entries(view).filter((entry) => !left_out_of_commit(view, entry)).length;

const decorations = new WeakMap<GitView, GitDecorations>();

export const decorations_of = (view: GitView): GitDecorations | null => {
  if (view.kind !== "repo") {
    return null;
  }
  const cached = decorations.get(view);
  if (cached) {
    return cached;
  }
  const built = git_decorations(view.entries);
  decorations.set(view, built);
  return built;
};

const apply_change = ({ root, view }: GitChange) =>
  git_store.update((state) => {
    const readable = view.kind === "repo" ? root : null;
    const known = state.views[root];
    if (view.kind === "loading" && known !== undefined && known.kind !== "none") {
      return state.readable === readable ? state : { ...state, readable };
    }
    return { ...state, readable, views: { ...state.views, [root]: view } };
  });

export const drop_git_session = () => git_store.update((state) => (state.readable === null ? state : { ...state, readable: null }));

const patch_ui_of = (key: string, change: (ui: GitUi) => GitUi) =>
  git_store.update((state) => {
    const current = git_ui_of(state, key);
    const next = change(current);
    return next === current ? state : { ...state, ui: { ...state.ui, [key]: next } };
  });

const patch_ui = (change: (ui: GitUi) => GitUi) => patch_ui_of(files_store.get().key, change);

export const set_surface = (surface: GitSurface) => patch_ui((ui) => (ui.surface === surface ? ui : { ...ui, surface }));

export const select_commit = (hash: string) => patch_ui((ui) => (ui.commit === hash ? ui : { ...ui, commit: hash }));

export const toggle_commit_file = (hash: string, path: string) =>
  patch_ui((ui) => ({ ...ui, commit_file: ui.commit_file?.hash === hash && ui.commit_file.path === path ? null : { hash, path } }));

export const remember_history_top = (key: string, top: number) => patch_ui_of(key, (ui) => (ui.history_top === top ? ui : { ...ui, history_top: top }));

export const set_viewer_mode = (path: string, mode: ViewerMode) =>
  patch_ui((ui) => ((ui.modes[path] ?? "file") === mode ? ui : { ...ui, modes: { ...ui.modes, [path]: mode } }));

const without_ui = (state: GitState, key: string): Record<string, GitUi> => Object.fromEntries(Object.entries(state.ui).filter(([entry]) => entry !== key));

export const adopt_git = (from_key: string, chat_id: string) =>
  git_store.update((state) => {
    const ui = state.ui[from_key];
    return ui ? { ...state, ui: { ...without_ui(state, from_key), [chat_id]: ui } } : state;
  });

export const refresh_git = () => {
  const { scope } = shown_view(files_store.get());
  api.invoke("git:refresh", scope).catch((error: unknown) => console.error(`[git] git:refresh failed for chat ${scope.chat_id ?? "none"} in ${scope.project_path || "no project"}`, error));
};

export const init_git = (): (() => void) => {
  const stop_changed = api.on("git:changed", apply_change);
  const stop_removed = api.on("chats:removed", ({ chat_id }) =>
    git_store.update((state) => (state.ui[chat_id] ? { ...state, ui: without_ui(state, chat_id) } : state)),
  );
  let key = files_store.get().key;
  const stop_key = files_store.subscribe(() => {
    const next = files_store.get().key;
    if (next === key) return;
    key = next;
    drop_git_session();
  });
  return () => {
    stop_changed();
    stop_removed();
    stop_key();
  };
};
