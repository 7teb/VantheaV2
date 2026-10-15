import type { FilesChange, FilesRoot, FilesScope, FileView } from "../../shared/ipc/files.ts";
import { api } from "../api/bridge.ts";
import { draft_key } from "./chat-drafts.ts";
import { create_store } from "./create-store.ts";
import { after_close, change_targets, type DirLoad } from "./files-tree.ts";
import { toggle_dock, ui_store } from "./ui.ts";

export type FileTab = { path: string; status: "loading" | "ready" | "failed"; view: FileView | null };

type RootLoad = { status: "idle" | "loading" | "ready" | "none" | "failed"; root: FilesRoot | null };

type MatchLoad = { status: "idle" | "loading" | "ready" | "failed"; query: string; paths: string[]; truncated: boolean };

export type FilesView = {
  scope: FilesScope;
  root: RootLoad;
  dirs: Record<string, DirLoad>;
  expanded: string[];
  tabs: FileTab[];
  active: string | null;
  tree_open: boolean;
  query: string;
  matches: MatchLoad;
};

export type FilesState = { key: string; views: Record<string, FilesView> };

type Claim = { slot: string; ticket: number };

const query_delay_ms = 150;

const idle_matches: MatchLoad = { status: "idle", query: "", paths: [], truncated: false };

const fresh_view = (scope: FilesScope, root: RootLoad, tree_open: boolean): FilesView => ({
  scope,
  root,
  dirs: {},
  expanded: [],
  tabs: [],
  active: null,
  tree_open,
  query: "",
  matches: idle_matches,
});

const blank_view = fresh_view({ chat_id: null, project_path: "" }, { status: "idle", root: null }, true);

const shown_scope = (): FilesScope => {
  const ui = ui_store.get();
  return { chat_id: ui.active_chat_id, project_path: ui.project_path };
};

const view_key = (scope: FilesScope) => draft_key(scope.chat_id, scope.project_path);

const shown_key = () => view_key(shown_scope());

export const files_store = create_store<FilesState>({ key: shown_key(), views: {} });

export const shown_view = (state: FilesState): FilesView => state.views[state.key] ?? blank_view;

let ticket_seq = 0;
const tickets = new Map<string, number>();
const root_loads = new Map<string, { scope: string; promise: Promise<FilesRoot | null> }>();
const query_timers = new Map<string, number>();

const scope_key = (scope: FilesScope) => `${scope.chat_id ?? ""}\n${scope.project_path}`;

const view_of = (key: string): FilesView | null => files_store.get().views[key] ?? null;

const shown = () => {
  const key = shown_key();
  return { key, view: view_of(key) ?? blank_view };
};

const update_view = (key: string, change: (view: FilesView) => FilesView) =>
  files_store.update((state) => {
    const view = state.views[key];
    return view ? { ...state, views: { ...state.views, [key]: change(view) } } : state;
  });

const take_ticket = (key: string, name: string): Claim => {
  ticket_seq += 1;
  const slot = `${key}\n${name}`;
  tickets.set(slot, ticket_seq);
  return { slot, ticket: ticket_seq };
};

const still_current = (claim: Claim) => tickets.get(claim.slot) === claim.ticket;

const forget_tickets = (key: string) => {
  for (const slot of [...tickets.keys()]) {
    if (slot.startsWith(`${key}\n`)) {
      tickets.delete(slot);
    }
  }
};

const patch_tab = (key: string, path: string, patch: Partial<FileTab>) =>
  update_view(key, (view) => ({ ...view, tabs: view.tabs.map((tab) => (tab.path === path ? { ...tab, ...patch } : tab)) }));

const set_dir = (key: string, path: string, load: DirLoad) => update_view(key, (view) => ({ ...view, dirs: { ...view.dirs, [path]: load } }));

const load_dir = async (key: string, scope: FilesScope, path: string) => {
  const claim = take_ticket(key, `dir:${path}`);
  if (!view_of(key)?.dirs[path]) {
    set_dir(key, path, { status: "loading", entries: [], more: 0 });
  }
  try {
    const listing = await api.invoke("files:list", scope, path);
    if (still_current(claim)) {
      set_dir(key, path, { status: "ready", entries: listing.entries, more: listing.more });
    }
  } catch (error) {
    console.error(`[files] files:list failed for ${path || "the root folder"}`, error);
    if (still_current(claim)) {
      set_dir(key, path, { status: "failed", entries: [], more: 0 });
    }
  }
};

const read_file = async (key: string, scope: FilesScope, path: string) => {
  const claim = take_ticket(key, `file:${path}`);
  try {
    const view = await api.invoke("files:read", scope, path);
    if (still_current(claim)) {
      patch_tab(key, path, { status: "ready", view });
    }
  } catch (error) {
    console.error(`[files] files:read failed for ${path}`, error);
    if (still_current(claim)) {
      patch_tab(key, path, { status: "failed" });
    }
  }
};

const find_files = async (key: string, scope: FilesScope, query: string) => {
  const claim = take_ticket(key, "find");
  update_view(key, (view) => ({ ...view, matches: { ...view.matches, status: "loading" } }));
  try {
    const result = await api.invoke("files:find", scope, query);
    if (still_current(claim)) {
      update_view(key, (view) => ({ ...view, matches: { status: "ready", query, paths: result.paths, truncated: result.truncated } }));
    }
  } catch (error) {
    console.error(`[files] files:find failed for ${JSON.stringify(query)}`, error);
    if (still_current(claim)) {
      update_view(key, (view) => ({ ...view, matches: { ...view.matches, status: "failed" } }));
    }
  }
};

const reset_view = (key: string, scope: FilesScope, root: RootLoad) => {
  forget_tickets(key);
  files_store.update((state) => ({
    ...state,
    views: { ...state.views, [key]: fresh_view(scope, root, (state.views[key] ?? shown_view(state)).tree_open) },
  }));
};

const settle_root = (key: string, scope: FilesScope, root: FilesRoot | null) => {
  if (root !== null && view_of(key)?.root.root?.path === root.path) {
    update_view(key, (view) => ({ ...view, scope, root: { status: "ready", root } }));
    return;
  }
  reset_view(key, scope, root ? { status: "ready", root } : { status: "none", root: null });
  if (root) {
    void load_dir(key, scope, "");
  }
};

const load_root = async (key: string, scope: FilesScope): Promise<FilesRoot | null> => {
  const claim = take_ticket(key, "root");
  update_view(key, (view) => ({ ...view, root: { ...view.root, status: "loading" } }));
  try {
    const root = await api.invoke("files:root", scope);
    if (!still_current(claim)) {
      return null;
    }
    settle_root(key, scope, root);
    return root;
  } catch (error) {
    console.error(`[files] files:root failed for chat ${scope.chat_id ?? "none"} in ${scope.project_path || "no project"}`, error);
    if (still_current(claim)) {
      reset_view(key, scope, { status: "failed", root: null });
    }
    return null;
  } finally {
    if (root_loads.get(key)?.scope === scope_key(scope)) {
      root_loads.delete(key);
    }
  }
};

const ensure_root = (key: string, scope: FilesScope): Promise<FilesRoot | null> => {
  const view = view_of(key);
  if (view && scope_key(view.scope) === scope_key(scope) && (view.root.status === "ready" || view.root.status === "none")) {
    return Promise.resolve(view.root.root);
  }
  const pending = root_loads.get(key);
  if (pending?.scope === scope_key(scope)) {
    return pending.promise;
  }
  if (!view) {
    reset_view(key, scope, { status: "idle", root: null });
  }
  const promise = load_root(key, scope);
  root_loads.set(key, { scope: scope_key(scope), promise });
  return promise;
};

const reload = (key: string, view: FilesView, change: Omit<FilesChange, "root">) => {
  const shown = ["", ...view.expanded].filter((dir) => view.dirs[dir] !== undefined);
  const targets = change_targets(change, shown, view.tabs.map((tab) => tab.path));
  for (const dir of targets.dirs) {
    void load_dir(key, view.scope, dir);
  }
  for (const file of targets.files) {
    void read_file(key, view.scope, file);
  }
  if (view.query.trim()) {
    void find_files(key, view.scope, view.query);
  }
};

const apply_change = (change: FilesChange) => {
  const { key, view } = shown();
  if (view.root.status === "ready" && view.root.root?.path === change.root) {
    reload(key, view, change);
  }
};

const drop_view = (key: string) => {
  forget_tickets(key);
  root_loads.delete(key);
  const timer = query_timers.get(key);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    query_timers.delete(key);
  }
  files_store.update((state) => ({ ...state, views: Object.fromEntries(Object.entries(state.views).filter(([entry]) => entry !== key)) }));
};

export const adopt_files = (from_key: string, chat_id: string) => {
  const view = view_of(from_key);
  if (!view) {
    return;
  }
  drop_view(from_key);
  const root: RootLoad = view.root.status === "ready" ? view.root : { status: "idle", root: null };
  files_store.update((state) => ({ ...state, views: { ...state.views, [chat_id]: { ...view, scope: { ...view.scope, chat_id }, root } } }));
};

export const sync_files = async () => {
  const scope = shown_scope();
  const key = view_key(scope);
  const shown_root = view_of(key)?.root.root?.path ?? null;
  const root = await ensure_root(key, scope);
  const view = view_of(key);
  if (root && view && root.path === shown_root) {
    reload(key, view, { paths: [], overflow: true });
  }
};

export const watch_files = () => {
  api.invoke("files:watch", shown_scope()).catch((error: unknown) => console.error("[files] files:watch failed", error));
};

export const unwatch_files = () => {
  api.invoke("files:unwatch").catch((error: unknown) => console.error("[files] files:unwatch failed", error));
};

export const toggle_dir = (path: string) => {
  const { key, view } = shown();
  const open = view.expanded.includes(path);
  update_view(key, (current) => ({ ...current, expanded: open ? current.expanded.filter((entry) => entry !== path) : [...current.expanded, path] }));
  if (!open) {
    void load_dir(key, view.scope, path);
  }
};

export const open_file = async (path: string) => {
  const scope = shown_scope();
  const key = view_key(scope);
  const root = await ensure_root(key, scope);
  if (!root) {
    return;
  }
  update_view(key, (view) => ({
    ...view,
    active: path,
    tabs: view.tabs.some((tab) => tab.path === path) ? view.tabs : [...view.tabs, { path, status: "loading", view: null }],
  }));
  await read_file(key, scope, path);
};

export const show_file = (path: string) => {
  if (ui_store.get().dock.kind !== "files") {
    toggle_dock("files");
  }
  void open_file(path);
};

export const select_file = (path: string) => update_view(shown_key(), (view) => ({ ...view, active: path }));

export const close_file = (path: string) =>
  update_view(shown_key(), (view) => ({
    ...view,
    tabs: view.tabs.filter((tab) => tab.path !== path),
    active: after_close(
      view.tabs.map((tab) => tab.path),
      path,
      view.active,
    ),
  }));

export const toggle_tree = () => update_view(shown_key(), (view) => ({ ...view, tree_open: !view.tree_open }));

export const set_query = (query: string) => {
  const { key, view: current } = shown();
  update_view(key, (view) => ({ ...view, query }));
  const timer = query_timers.get(key);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    query_timers.delete(key);
  }
  if (!query.trim()) {
    take_ticket(key, "find");
    update_view(key, (view) => ({ ...view, matches: idle_matches }));
    return;
  }
  query_timers.set(
    key,
    window.setTimeout(() => {
      query_timers.delete(key);
      void find_files(key, current.scope, query);
    }, query_delay_ms),
  );
};

export const reveal_file = async (path: string) => {
  try {
    await api.invoke("files:reveal", shown().view.scope, path);
  } catch (error) {
    console.error(`[files] files:reveal failed for ${path}`, error);
  }
};

export const init_files = (): (() => void) => {
  const stop_changed = api.on("files:changed", apply_change);
  const stop_removed = api.on("chats:removed", ({ chat_id }) => drop_view(chat_id));
  const stop_key = ui_store.subscribe(() => {
    const key = shown_key();
    if (files_store.get().key !== key) {
      files_store.update((state) => ({ ...state, key }));
    }
  });
  return () => {
    stop_changed();
    stop_removed();
    stop_key();
  };
};
