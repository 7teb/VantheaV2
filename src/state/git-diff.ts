import type { GitFileDiff, GitView, LineCount } from "../../shared/git-view.ts";
import type { FilesChange } from "../../shared/ipc/files.ts";
import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";
import { files_store, shown_view } from "./files.ts";
import { git_store, shown_root } from "./git.ts";

export type GitLoad<T> = { status: "loading" | "ready" | "failed"; value: T | null; fresh: boolean };

export type GitDiffState = { diffs: Record<string, GitLoad<GitFileDiff>>; counts: Record<string, GitLoad<LineCount[]>> };

export const git_diff_store = create_store<GitDiffState>({ diffs: {}, counts: {} });

const inflight = new Set<string>();

const diff_key = (root: string, path: string) => `${root}\n${path}`;

export const diff_of = (state: GitDiffState, root: string, path: string): GitLoad<GitFileDiff> | null => state.diffs[diff_key(root, path)] ?? null;

export const counts_of = (state: GitDiffState, root: string): GitLoad<LineCount[]> | null => state.counts[root] ?? null;

const starting = <T>(load: GitLoad<T> | undefined): GitLoad<T> => ({ status: load?.value ? load.status : "loading", value: load?.value ?? null, fresh: true });

const settled = <T>(load: GitLoad<T> | undefined, status: "ready" | "failed", value: T | null): GitLoad<T> => ({ status, value, fresh: load?.fresh ?? true });

const stale = <T>(load: GitLoad<T>): GitLoad<T> => (load.fresh ? { ...load, fresh: false } : load);

const set_diff = (key: string, change: (load: GitLoad<GitFileDiff> | undefined) => GitLoad<GitFileDiff>) =>
  git_diff_store.update((state) => ({ ...state, diffs: { ...state.diffs, [key]: change(state.diffs[key]) } }));

const set_counts = (root: string, change: (load: GitLoad<LineCount[]> | undefined) => GitLoad<LineCount[]>) =>
  git_diff_store.update((state) => ({ ...state, counts: { ...state.counts, [root]: change(state.counts[root]) } }));

const shown_scope = () => shown_view(files_store.get()).scope;

export const load_diff = async (root: string, path: string) => {
  const key = diff_key(root, path);
  if (inflight.has(key)) {
    return;
  }
  inflight.add(key);
  set_diff(key, starting);
  let finish: (load: GitLoad<GitFileDiff> | undefined) => GitLoad<GitFileDiff>;
  try {
    const diff = await api.invoke("git:diff", shown_scope(), path);
    finish = (load) => settled(load, "ready", diff);
  } catch (error) {
    console.error(`[git] git:diff failed for ${path} in ${root}`, error);
    finish = (load) => settled(load, "failed", load?.value ?? null);
  }
  inflight.delete(key);
  set_diff(key, finish);
};

export const load_counts = async (root: string) => {
  const key = `counts\n${root}`;
  if (inflight.has(key)) {
    return;
  }
  inflight.add(key);
  set_counts(root, starting);
  let finish: (load: GitLoad<LineCount[]> | undefined) => GitLoad<LineCount[]>;
  try {
    const counts = await api.invoke("git:line_counts", shown_scope());
    finish = (load) => settled(load, "ready", counts);
  } catch (error) {
    console.error(`[git] git:line_counts failed in ${root}`, error);
    finish = (load) => settled(load, "failed", load?.value ?? null);
  }
  inflight.delete(key);
  set_counts(root, finish);
};

const touched = (path: string, changed: string[]): boolean => {
  const key = path.toLowerCase();
  return changed.some((entry) => {
    const target = entry.toLowerCase();
    return key === target || key.startsWith(`${target}/`);
  });
};

const mark_stale = (state: GitDiffState, root: string, hit: (path: string) => boolean, kept: (path: string) => boolean): GitDiffState => {
  const prefix = diff_key(root, "");
  let touched_any = false;
  const diffs: Record<string, GitLoad<GitFileDiff>> = {};
  for (const [key, load] of Object.entries(state.diffs)) {
    const path = key.startsWith(prefix) ? key.slice(prefix.length) : null;
    if (path !== null && !kept(path)) {
      touched_any = true;
      continue;
    }
    const next = path !== null && hit(path) ? stale(load) : load;
    touched_any ||= next !== load;
    diffs[key] = next;
  }
  const counts = state.counts[root];
  const counts_next = counts ? stale(counts) : undefined;
  if (!touched_any && counts_next === counts) {
    return state;
  }
  return { diffs: touched_any ? diffs : state.diffs, counts: counts_next && counts_next !== counts ? { ...state.counts, [root]: counts_next } : state.counts };
};

const view_paths = (view: GitView): Set<string> =>
  new Set(view.kind === "repo" ? view.entries.flatMap((entry) => (entry.orig_path === null ? [entry.path] : [entry.path, entry.orig_path])) : []);

const on_view = (root: string, view: GitView) => {
  const paths = view_paths(view);
  git_diff_store.update((state) => mark_stale(state, root, () => true, (path) => paths.has(path)));
};

export const reload_git_diffs = () => {
  const root = shown_root(files_store.get());
  if (root !== null) {
    git_diff_store.update((state) => mark_stale(state, root, () => true, () => true));
  }
};

const on_files_changed = (change: FilesChange) =>
  git_diff_store.update((state) => mark_stale(state, change.root, (path) => change.overflow || touched(path, change.paths), () => true));

export const init_git_diff = (): (() => void) => {
  let views: Record<string, GitView> = git_store.get().views;
  const stop_views = git_store.subscribe(() => {
    const next = git_store.get().views;
    if (next === views) {
      return;
    }
    const before = views;
    views = next;
    for (const [root, view] of Object.entries(next)) {
      if (before[root] !== view) {
        on_view(root, view);
      }
    }
  });
  const stop_files = api.on("files:changed", on_files_changed);
  return () => {
    stop_views();
    stop_files();
  };
};
