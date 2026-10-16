import type { CommitDetail, GitFileDiff, GraphRow, HistoryPage } from "../../shared/git-view.ts";
import type { FilesScope } from "../../shared/ipc/files.ts";
import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";
import { files_store, shown_view } from "./files.ts";
import type { GitLoad } from "./git-diff.ts";
import { git_store, git_view_of, shown_root } from "./git.ts";

export type HistoryList = { fingerprint: string; rows: GraphRow[]; done: boolean; shallow_end: boolean; status: "ready" | "loading_more" | "failed" };

export type GitHistoryState = { lists: Record<string, HistoryList>; commits: Record<string, GitLoad<CommitDetail>>; diffs: Record<string, GitLoad<GitFileDiff>> };

export const git_history_store = create_store<GitHistoryState>({ lists: {}, commits: {}, diffs: {} });

const inflight = new Set<string>();

const list_loads = new Set<string>();

const reloads = new Set<string>();

let viewers = 0;

const commit_key = (root: string, hash: string) => `${root}\n${hash}`;

const file_key = (root: string, hash: string, path: string) => `${root}\n${hash}\n${path}`;

export const history_of = (state: GitHistoryState, root: string | null): HistoryList | null => (root === null ? null : (state.lists[root] ?? null));

export const commit_of = (state: GitHistoryState, root: string, hash: string): GitLoad<CommitDetail> | null => state.commits[commit_key(root, hash)] ?? null;

export const commit_diff_of = (state: GitHistoryState, root: string, hash: string, path: string): GitLoad<GitFileDiff> | null =>
  state.diffs[file_key(root, hash, path)] ?? null;

const shown_scope = (): FilesScope => shown_view(files_store.get()).scope;

const request_page = (scope: FilesScope, fingerprint: string | null, offset: number): Promise<HistoryPage> => api.invoke("git:history", scope, { fingerprint, offset });

const set_list = (root: string, change: (list: HistoryList | undefined) => HistoryList) =>
  git_history_store.update((state) => ({ ...state, lists: { ...state.lists, [root]: change(state.lists[root]) } }));

const merged = (rows: GraphRow[], page: HistoryPage): GraphRow[] => (page.start === 0 ? page.rows : [...rows, ...page.rows]);

const served = (root: string) => git_store.get().readable === root && shown_root(files_store.get()) === root;

const unlisted_fingerprint = (root: string): string | null => {
  const view = git_view_of(git_store.get(), root);
  return view.kind === "repo" && git_history_store.get().lists[root]?.fingerprint !== view.fingerprint ? view.fingerprint : null;
};

const send_close = () => {
  if (viewers > 0 || list_loads.size > 0) {
    return;
  }
  api.invoke("git:history_close").catch((error: unknown) => console.error("[git] git:history_close failed", error));
};

const begin_list = (root: string): boolean => {
  if (list_loads.has(root)) {
    return false;
  }
  list_loads.add(root);
  return true;
};

const end_list = (root: string) => {
  list_loads.delete(root);
  const wanted = reloads.delete(root) && viewers > 0 && served(root) ? unlisted_fingerprint(root) : null;
  if (wanted !== null) {
    void load_history(root, wanted);
    return;
  }
  send_close();
};

export const load_history = async (root: string, wanted: string) => {
  if (!begin_list(root)) {
    reloads.add(root);
    return;
  }
  const scope = shown_scope();
  const depth = git_history_store.get().lists[root]?.rows.length ?? 0;
  try {
    let page = await request_page(scope, null, 0);
    let rows = page.rows;
    while (!page.done && rows.length < depth && served(root)) {
      page = await request_page(scope, page.fingerprint, rows.length);
      rows = merged(rows, page);
    }
    if (!served(root)) {
      return;
    }
    const { fingerprint, done, shallow_end } = page;
    set_list(root, () => ({ fingerprint, rows, done, shallow_end, status: "ready" }));
  } catch (error) {
    console.error(`[git] git:history failed for ${root} at fingerprint ${wanted}`, error);
    if (served(root)) {
      set_list(root, () => ({ fingerprint: wanted, rows: [], done: false, shallow_end: false, status: "failed" }));
    }
  } finally {
    end_list(root);
  }
};

export const load_more_history = async (root: string) => {
  const list = git_history_store.get().lists[root];
  if (!list || list.done || list.status !== "ready" || !served(root) || !begin_list(root)) {
    return;
  }
  set_list(root, (current) => ({ ...(current ?? list), status: "loading_more" }));
  try {
    const page = await request_page(shown_scope(), list.fingerprint, list.rows.length);
    set_list(root, (current) => {
      const base = current ?? list;
      const fits = page.start === 0 || (page.fingerprint === base.fingerprint && page.start === base.rows.length);
      if (!fits) {
        return { ...base, status: "ready" };
      }
      return { fingerprint: page.fingerprint, rows: merged(base.rows, page), done: page.done, shallow_end: page.shallow_end, status: "ready" };
    });
  } catch (error) {
    console.error(`[git] git:history failed for ${root} at offset ${list.rows.length}`, error);
    set_list(root, (current) => ({ ...(current ?? list), status: served(root) ? "failed" : "ready" }));
  } finally {
    end_list(root);
  }
};

const without = <T>(record: Record<string, T>, key: string): Record<string, T> => Object.fromEntries(Object.entries(record).filter(([entry]) => entry !== key));

const retried_lists = (lists: Record<string, HistoryList>, root: string): Record<string, HistoryList> => {
  const list = lists[root];
  if (list?.status !== "failed") {
    return lists;
  }
  return list.rows.length > 0 ? { ...lists, [root]: { ...list, status: "ready" } } : without(lists, root);
};

const without_failed = <T>(loads: Record<string, GitLoad<T>>, root: string): Record<string, GitLoad<T>> =>
  Object.fromEntries(Object.entries(loads).filter(([key, load]) => load.status !== "failed" || !key.startsWith(commit_key(root, ""))));

export const reload_git_history = () => {
  const root = git_store.get().readable;
  if (root !== null) {
    git_history_store.update((state) => ({ lists: retried_lists(state.lists, root), commits: without_failed(state.commits, root), diffs: without_failed(state.diffs, root) }));
  }
};

export const open_history = () => {
  viewers += 1;
};

export const close_history = () => {
  viewers -= 1;
  send_close();
};

const write_commit = (key: string) => (load: GitLoad<CommitDetail> | null) =>
  git_history_store.update((state) => ({ ...state, commits: load ? { ...state.commits, [key]: load } : without(state.commits, key) }));

const write_diff = (key: string) => (load: GitLoad<GitFileDiff> | null) =>
  git_history_store.update((state) => ({ ...state, diffs: load ? { ...state.diffs, [key]: load } : without(state.diffs, key) }));

const fetch_into = async <T>(root: string, key: string, write: (load: GitLoad<T> | null) => void, read: () => Promise<T>, label: string) => {
  if (inflight.has(key)) {
    return;
  }
  inflight.add(key);
  write({ status: "loading", value: null, fresh: true });
  try {
    write({ status: "ready", value: await read(), fresh: true });
  } catch (error) {
    console.error(`[git] ${label} failed`, error);
    write(served(root) ? { status: "failed", value: null, fresh: true } : null);
  } finally {
    inflight.delete(key);
  }
};

export const load_commit = (root: string, hash: string) =>
  fetch_into(root, commit_key(root, hash), write_commit(commit_key(root, hash)), () => api.invoke("git:commit", shown_scope(), hash), `git:commit for ${hash} in ${root}`);

export const load_commit_diff = (root: string, hash: string, path: string) =>
  fetch_into(
    root,
    file_key(root, hash, path),
    write_diff(file_key(root, hash, path)),
    () => api.invoke("git:commit_diff", shown_scope(), hash, path),
    `git:commit_diff for ${path} in ${hash} in ${root}`,
  );
