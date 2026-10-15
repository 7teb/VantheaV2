import { WebContentsView } from "electron";
import type { BrowserChatTabs, BrowserHistoryAction, BrowserTabInfo } from "../../shared/ipc/browser.ts";
import { emit } from "../ipc/handle.ts";
import { listen_for_dialogs } from "./cdp.ts";
import { console_buffer } from "./console.ts";
import { dialog_log } from "./dialogs.ts";
import { guest_preferences, secure_guest } from "./guest-security.ts";
import { step_history } from "./navigate.ts";
import { acquire_partition, adopt_partition, pending_wipe, release_partition } from "./profiles.ts";
import { error_text, invalidate_tab, pause, random_id, tab_title, tab_url, type BrowserTab } from "./state.ts";
import { create_surface, default_tab_size, destroy_surface } from "./surface.ts";
import { watch_tab } from "./watch.ts";

export type TabInfo = BrowserTabInfo & { active: boolean };

const first_load_timeout_ms = 20000;

const tabs = new Map<string, BrowserTab>();
const active_ids = new Map<string, string>();
const changed_chats = new Set<string>();
const change_listeners = new Set<() => void>();
let flush_pending = false;

export const chat_tabs = (chat_id: string): BrowserTab[] => [...tabs.values()].filter((tab) => tab.chat_id === chat_id);

export const active_tab = (chat_id: string): BrowserTab | null => tabs.get(active_ids.get(chat_id) ?? "") ?? null;

export const is_open = (tab: BrowserTab) => tabs.get(tab.tab_id) === tab;

const tab_info = (tab: BrowserTab): BrowserTabInfo => {
  const live = !tab.guest.isDestroyed();
  return {
    tab_id: tab.tab_id,
    url: tab_url(tab),
    title: tab_title(tab),
    loading: tab.loading,
    can_back: live && tab.guest.navigationHistory.canGoBack(),
    can_forward: live && tab.guest.navigationHistory.canGoForward(),
    error: tab.error,
    crashed: tab.crashed,
  };
};

export const chat_state = (chat_id: string): BrowserChatTabs => ({ chat_id, tabs: chat_tabs(chat_id).map(tab_info), active_id: active_ids.get(chat_id) ?? "" });

export const list_tabs = (chat_id: string): TabInfo[] => {
  const active_id = active_ids.get(chat_id) ?? "";
  return chat_tabs(chat_id).map((tab) => ({ ...tab_info(tab), active: tab.tab_id === active_id }));
};

const flush = () => {
  flush_pending = false;
  const chats = [...changed_chats];
  changed_chats.clear();
  for (const chat_id of chats) {
    emit("browser:changed", chat_state(chat_id));
  }
  for (const listener of [...change_listeners]) {
    listener();
  }
};

const publish = (chat_id: string) => {
  changed_chats.add(chat_id);
  if (!flush_pending) {
    flush_pending = true;
    setImmediate(flush);
  }
};

export const on_tabs_changed = (listener: () => void): (() => void) => {
  change_listeners.add(listener);
  return () => {
    change_listeners.delete(listener);
  };
};

const release_view = (tab: BrowserTab) => {
  if (!tab.host.isDestroyed()) {
    tab.host.contentView.removeChildView(tab.view);
  }
  if (!tab.guest.isDestroyed()) {
    if (tab.guest.debugger.isAttached()) {
      try {
        tab.guest.debugger.detach();
      } catch (error) {
        console.warn(`[browser] detaching the debugger from tab ${tab.tab_id} failed: ${error_text(error)}`);
      }
    }
    tab.guest.close();
  }
  destroy_surface(tab.surface);
};

const dispose = (tab: BrowserTab) => {
  if (!is_open(tab)) {
    return;
  }
  const siblings = chat_tabs(tab.chat_id);
  const index = siblings.indexOf(tab);
  tabs.delete(tab.tab_id);
  if (active_ids.get(tab.chat_id) === tab.tab_id) {
    const remaining = siblings.filter((entry) => entry !== tab);
    const next = remaining[Math.min(index, remaining.length - 1)];
    if (next) {
      active_ids.set(tab.chat_id, next.tab_id);
    } else {
      active_ids.delete(tab.chat_id);
    }
  }
  invalidate_tab(tab, true);
  tab.release();
  release_view(tab);
  if (![...tabs.values()].some((entry) => entry.partition === tab.partition)) {
    release_partition(tab.partition);
  }
  publish(tab.chat_id);
};

const load_now = (tab: BrowserTab, url: string) => {
  tab.guest.loadURL(url).catch((error: unknown) => {
    if ((error as { code?: string }).code !== "ERR_ABORTED") {
      console.warn(`[browser] loading ${url.slice(0, 200)} in tab ${tab.tab_id} failed: ${error_text(error)}`);
    }
  });
};

const start_load = (tab: BrowserTab, url: string) => {
  const wipe = pending_wipe(tab.partition);
  if (!wipe) {
    load_now(tab, url);
    return;
  }
  void wipe.then(() => {
    if (is_open(tab)) {
      load_now(tab, url);
    }
  });
};

const create_tab = (chat_id: string): BrowserTab => {
  const partition = acquire_partition(chat_id);
  const surface = create_surface(default_tab_size);
  let view: WebContentsView;
  try {
    view = new WebContentsView({ webPreferences: guest_preferences(partition) });
    surface.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, ...default_tab_size });
    surface.showInactive();
  } catch (error) {
    destroy_surface(surface);
    throw new Error(`Could not create a browser tab: ${error_text(error)}`, { cause: error });
  }
  const tab: BrowserTab = {
    tab_id: random_id("browser"),
    chat_id,
    view,
    surface,
    host: surface,
    guest: view.webContents,
    partition,
    crashed: false,
    loading: false,
    url: "about:blank",
    title: "",
    error: "",
    epoch: 1,
    queue: pending_wipe(partition) ?? Promise.resolve(),
    debugger_attached: false,
    sessions: new Map(),
    snapshots: new Map(),
    snapshot_seq: 0,
    visuals: new Map(),
    console: console_buffer(),
    dialogs: dialog_log(),
    waiters: new Set(),
    release: () => undefined,
  };
  secure_guest(tab.guest, (url) => start_load(create_tab(tab.chat_id), url));
  tab.release = watch_tab(
    tab,
    () => publish(tab.chat_id),
    () => dispose(tab),
  );
  listen_for_dialogs(tab);
  tabs.set(tab.tab_id, tab);
  active_ids.set(chat_id, tab.tab_id);
  publish(chat_id);
  return tab;
};

export const owned_tab = (chat_id: string, tab_id: string | null): BrowserTab => {
  const tab = tabs.get(tab_id || active_ids.get(chat_id) || "");
  if (tab && tab.chat_id === chat_id) {
    return tab;
  }
  if (tab_id) {
    throw new Error(`Browser tab ${tab_id} is not open in this chat. Call browser_tabs to list this chat's tabs.`);
  }
  throw new Error('This chat has no open browser tab. Call browser_tab with action "new" first.');
};

export const open_user_tab = (chat_id: string, url: string): BrowserTab => {
  const tab = create_tab(chat_id);
  start_load(tab, url);
  return tab;
};

export const open_tab = async (chat_id: string, url: string, signal: AbortSignal): Promise<BrowserTab> => {
  signal.throwIfAborted();
  const tab = open_user_tab(chat_id, url);
  const deadline = Date.now() + first_load_timeout_ms;
  while (url !== "about:blank" && is_open(tab) && (tab.loading || tab_url(tab) === "about:blank") && Date.now() < deadline) {
    await pause(tab, deadline - Date.now(), signal);
  }
  return tab;
};

export const select_tab = (chat_id: string, tab_id: string | null): BrowserTab => {
  const tab = owned_tab(chat_id, tab_id);
  if (active_ids.get(chat_id) !== tab.tab_id) {
    active_ids.set(chat_id, tab.tab_id);
    publish(chat_id);
  }
  return tab;
};

export const close_tab = (chat_id: string, tab_id: string) => dispose(owned_tab(chat_id, tab_id));

export const load_url = (chat_id: string, tab_id: string, url: string) => start_load(owned_tab(chat_id, tab_id), url);

export const step_tab_history = (chat_id: string, tab_id: string, action: BrowserHistoryAction) => step_history(owned_tab(chat_id, tab_id), action);

export const close_chat_tabs = (chat_id: string) => {
  for (const tab of chat_tabs(chat_id)) {
    dispose(tab);
  }
};

export const close_all_tabs = () => {
  for (const tab of [...tabs.values()]) {
    dispose(tab);
  }
};

export const adopt_tabs = (from: string, to: string) => {
  const moved = chat_tabs(from);
  if (!moved.length || from === to) {
    return;
  }
  for (const tab of moved) {
    tab.chat_id = to;
  }
  adopt_partition(from, to);
  const active_id = active_ids.get(from);
  active_ids.delete(from);
  if (active_id && !active_ids.has(to)) {
    active_ids.set(to, active_id);
  }
  publish(from);
  publish(to);
};

const queue_tab = <T>(tab: BrowserTab, signal: AbortSignal, work: () => Promise<T>): Promise<T> => {
  const run = tab.queue.then(() => {
    signal.throwIfAborted();
    return work();
  });
  tab.queue = Promise.allSettled([run]);
  return run;
};

export const run_on_tab = <T>(chat_id: string, tab_id: string | null, signal: AbortSignal, work: (tab: BrowserTab) => Promise<T>): Promise<T> => {
  const tab = select_tab(chat_id, tab_id);
  return queue_tab(tab, signal, () => work(tab));
};
