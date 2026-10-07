import { session, webContents, type BrowserWindow, type WebContents } from "electron";
import type { BrowserCommand, BrowserCommandResult, BrowserTabRegistration } from "../../shared/ipc/panels.ts";
import { main_window } from "../app/window.ts";
import { emit } from "../ipc/handle.ts";
import { handle_debugger_message } from "./cdp.ts";
import { browser_partition } from "./guest-policy.ts";
import { error_text, invalidate_tab, notify_tab, random_id, tab_title, tab_url, type BrowserTab } from "./state.ts";

type CommandBody = BrowserCommand extends infer C ? (C extends BrowserCommand ? Omit<C, "command_id"> : never) : never;

type PendingCommand = { resolve: (result: BrowserCommandResult) => void; reject: (error: unknown) => void; release: () => void };

export type TabInfo = { tab_id: string; active: boolean; attached: boolean; loading: boolean; url: string; title: string };

const command_timeout_ms = 20000;
const activation_timeout_ms = 15000;

const tabs = new Map<string, BrowserTab>();
const guest_tabs = new Map<number, string>();
const pending = new Map<string, PendingCommand>();
const registry_waiters = new Set<() => void>();
let active_tab_id = "";
let host: BrowserWindow | null = null;

const notify_registry = () => {
  for (const waiter of [...registry_waiters]) {
    waiter();
  }
};

const reject_commands = (reason: string) => {
  for (const [command_id, entry] of pending) {
    pending.delete(command_id);
    entry.release();
    entry.reject(new Error(reason));
  }
};

const release_guest = (tab: BrowserTab) => {
  tab.release();
  if (tab.guest.isDestroyed() || !tab.guest.debugger.isAttached()) {
    return;
  }
  try {
    tab.guest.debugger.detach();
  } catch (error) {
    console.warn(`[browser] detaching debugger from tab ${tab.tab_id} failed: ${error_text(error)}`);
  }
};

const cleanup_tab = (tab_id: string) => {
  const tab = tabs.get(tab_id);
  if (!tab) {
    return;
  }
  invalidate_tab(tab, true);
  release_guest(tab);
  tabs.delete(tab_id);
  guest_tabs.delete(tab.web_contents_id);
  notify_registry();
};

const cleanup_browser = (reason: string) => {
  reject_commands(reason);
  for (const tab_id of [...tabs.keys()]) {
    cleanup_tab(tab_id);
  }
};

const attach_host = (window: BrowserWindow) => {
  if (window === host) {
    return;
  }
  host = window;
  window.webContents.on("render-process-gone", () => cleanup_browser("Browser renderer crashed."));
  window.webContents.on("destroyed", () => cleanup_browser("Browser window closed."));
  window.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame) {
      reject_commands("Browser renderer reloaded.");
    }
  });
  window.on("closed", () => {
    cleanup_browser("Browser window closed.");
    host = null;
  });
};

const create_tab = (tab_id: string, guest: WebContents): BrowserTab => {
  const tab: BrowserTab = {
    tab_id,
    web_contents_id: guest.id,
    guest,
    active: false,
    attached: true,
    loading: guest.isLoading(),
    url: guest.getURL() || "about:blank",
    title: guest.getTitle(),
    epoch: 1,
    queue: Promise.resolve(),
    debugger_attached: false,
    sessions: new Map(),
    snapshots: new Map(),
    snapshot_seq: 0,
    visuals: new Map(),
    waiters: new Set(),
    release: () => undefined,
  };
  const on_message = (_event: unknown, method: string, params: Record<string, unknown>, session_id: string) =>
    handle_debugger_message(tab, method, params ?? {}, session_id);
  const on_detach = () => {
    tab.debugger_attached = false;
    tab.sessions.clear();
    invalidate_tab(tab, true);
  };
  const on_start = () => {
    tab.loading = true;
    notify_tab(tab);
  };
  const on_stop = () => {
    tab.loading = false;
    tab.url = guest.getURL() || tab.url;
    tab.title = guest.getTitle() || tab.title;
    notify_tab(tab);
  };
  const on_navigate = (_event: unknown, url: string) => {
    tab.url = url || tab.url;
    invalidate_tab(tab, true);
  };
  const on_in_page = (_event: unknown, url: string, is_main_frame: boolean) => {
    if (is_main_frame) {
      tab.url = url || tab.url;
      notify_tab(tab);
    }
  };
  const on_title = (_event: unknown, title: string) => {
    tab.title = title;
    notify_tab(tab);
  };
  const on_gone = () => {
    tab.loading = false;
    tab.attached = false;
    invalidate_tab(tab, true);
  };
  const on_destroyed = () => cleanup_tab(tab_id);
  guest.debugger.on("message", on_message);
  guest.debugger.on("detach", on_detach);
  guest.on("did-start-loading", on_start);
  guest.on("did-stop-loading", on_stop);
  guest.on("did-navigate", on_navigate);
  guest.on("did-navigate-in-page", on_in_page);
  guest.on("page-title-updated", on_title);
  guest.on("render-process-gone", on_gone);
  guest.on("destroyed", on_destroyed);
  tab.release = () => {
    guest.debugger.off("message", on_message);
    guest.debugger.off("detach", on_detach);
    guest.off("did-start-loading", on_start);
    guest.off("did-stop-loading", on_stop);
    guest.off("did-navigate", on_navigate);
    guest.off("did-navigate-in-page", on_in_page);
    guest.off("page-title-updated", on_title);
    guest.off("render-process-gone", on_gone);
    guest.off("destroyed", on_destroyed);
  };
  return tab;
};

const refuse = (registration: BrowserTabRegistration, reason: string) => {
  console.warn(`[browser] refused tab ${registration.tab_id} (web contents ${registration.web_contents_id}): ${reason}`);
  return false;
};

export const register_tab = (registration: BrowserTabRegistration): boolean => {
  const window = main_window();
  if (!window || window.isDestroyed()) {
    return refuse(registration, "no host window");
  }
  attach_host(window);
  const guest = webContents.fromId(registration.web_contents_id);
  if (!guest || guest.isDestroyed() || guest.getType() !== "webview") {
    return refuse(registration, "not a live webview guest");
  }
  if (guest.hostWebContents !== window.webContents) {
    return refuse(registration, "guest is not hosted by the main window");
  }
  if (guest.session !== session.fromPartition(browser_partition)) {
    return refuse(registration, "guest uses the wrong session");
  }
  const existing = tabs.get(registration.tab_id);
  const existing_owner = guest_tabs.get(guest.id);
  if ((existing && existing.guest !== guest) || (existing_owner !== undefined && existing_owner !== registration.tab_id)) {
    return refuse(registration, "guest or tab id is already registered");
  }
  if (!existing) {
    const tab = create_tab(registration.tab_id, guest);
    tab.active = tab.tab_id === active_tab_id;
    tabs.set(tab.tab_id, tab);
    guest_tabs.set(guest.id, tab.tab_id);
  }
  notify_registry();
  return true;
};

export const unregister_tab = (tab_id: string) => {
  cleanup_tab(tab_id);
};

export const set_active_tab = (tab_id: string | null) => {
  active_tab_id = tab_id ?? "";
  for (const tab of tabs.values()) {
    const active = tab.tab_id === active_tab_id;
    if (tab.active && !active) {
      tab.snapshots.clear();
      tab.visuals.clear();
    }
    tab.active = active;
    notify_tab(tab);
  }
  notify_registry();
};

export const resolve_command = (result: BrowserCommandResult) => {
  const entry = pending.get(result.command_id);
  if (!entry) {
    return;
  }
  pending.delete(result.command_id);
  entry.release();
  entry.resolve(result);
};

const send_command = (body: CommandBody, signal: AbortSignal): Promise<BrowserCommandResult> => {
  signal.throwIfAborted();
  const window = main_window();
  if (!window || window.isDestroyed()) {
    throw new Error("Browser window is unavailable.");
  }
  attach_host(window);
  const command_id = random_id("browser-command");
  return new Promise<BrowserCommandResult>((resolve, reject) => {
    const fail = (error: unknown) => {
      if (pending.delete(command_id)) {
        release();
        reject(error);
      }
    };
    const on_abort = () => fail(signal.reason);
    const timer = setTimeout(() => fail(new Error(`Browser panel did not answer "${body.action}" within ${command_timeout_ms} ms.`)), command_timeout_ms);
    const release = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", on_abort);
    };
    pending.set(command_id, {
      resolve: (result) => (result.ok ? resolve(result) : reject(new Error(result.error || `Browser command "${body.action}" failed.`))),
      reject,
      release,
    });
    signal.addEventListener("abort", on_abort, { once: true });
    emit("browser:command", { ...body, command_id } as BrowserCommand);
  });
};

const wait_until = (predicate: () => boolean, timeout_ms: number, failure: string, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      registry_waiters.delete(check);
      signal.removeEventListener("abort", on_abort);
    };
    const check = () => {
      if (predicate()) {
        finish();
        resolve();
      }
    };
    const on_abort = () => {
      finish();
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error(failure));
    }, timeout_ms);
    registry_waiters.add(check);
    signal.addEventListener("abort", on_abort, { once: true });
    check();
  });

const usable = (tab: BrowserTab | undefined): tab is BrowserTab => Boolean(tab && tab.active && tab.attached && !tab.guest.isDestroyed());

export const find_tab = (tab_id: string | null) => tabs.get(tab_id || active_tab_id) ?? null;

export const ensure_active = async (tab_id: string | null, signal: AbortSignal): Promise<BrowserTab> => {
  const wanted = tab_id || active_tab_id;
  if (!tabs.has(wanted)) {
    throw new Error(tab_id ? `Browser tab ${tab_id} is not open. Call browser_tabs to list the open tabs.` : 'No active browser tab. Call browser_tab with action "new" first.');
  }
  if (!tabs.get(wanted)?.active) {
    await send_command({ action: "select", tab_id: wanted }, signal);
    await wait_until(() => Boolean(tabs.get(wanted)?.active), activation_timeout_ms, `Browser tab ${wanted} could not be activated.`, signal);
  }
  const tab = tabs.get(wanted);
  if (!usable(tab)) {
    throw new Error(`Browser tab ${wanted} could not be activated.`);
  }
  return tab;
};

export const open_tab = async (url: string, signal: AbortSignal): Promise<BrowserTab> => {
  const result = await send_command({ action: "new", url }, signal);
  const tab_id = result.tab_id;
  if (!tab_id) {
    throw new Error("Browser panel opened a tab without reporting its id.");
  }
  await wait_until(() => usable(tabs.get(tab_id)), activation_timeout_ms, `Browser tab ${tab_id} did not become active.`, signal);
  return ensure_active(tab_id, signal);
};

export const close_tab = async (tab_id: string, signal: AbortSignal) => {
  await send_command({ action: "close", tab_id }, signal);
  await wait_until(() => !tabs.has(tab_id), activation_timeout_ms, `Browser tab ${tab_id} is still open.`, signal);
};

export const list_tabs = (): TabInfo[] =>
  [...tabs.values()].map((tab) => ({ tab_id: tab.tab_id, active: tab.active, attached: tab.attached, loading: tab.loading, url: tab_url(tab), title: tab_title(tab) }));

const queue_tab = <T>(tab: BrowserTab, signal: AbortSignal, work: () => Promise<T>): Promise<T> => {
  const run = tab.queue.then(() => {
    signal.throwIfAborted();
    return work();
  });
  tab.queue = Promise.allSettled([run]);
  return run;
};

export const run_on_tab = async <T>(tab_id: string | null, signal: AbortSignal, work: (tab: BrowserTab) => Promise<T>): Promise<T> => {
  const tab = await ensure_active(tab_id, signal);
  return queue_tab(tab, signal, () => work(tab));
};
