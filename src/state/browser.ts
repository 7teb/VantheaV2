import type { BrowserCommand, BrowserCommandResult } from "../../shared/ipc/panels.ts";
import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";
import { toggle_dock, ui_store } from "./ui.ts";

export type BrowserGuest = HTMLElement & {
  getWebContentsId: () => number;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  loadURL: (url: string) => Promise<void>;
};

export type BrowserTab = {
  id: string;
  initial_url: string;
  url: string;
  draft: string | null;
  title: string;
  loading: boolean;
  can_back: boolean;
  can_forward: boolean;
  error: string;
  registered: boolean;
};

export type BrowserState = { tabs: BrowserTab[]; active_id: string; confirmed_id: string; mounted: boolean };

export const browser_store = create_store<BrowserState>({ tabs: [], active_id: "", confirmed_id: "", mounted: false });

const command_wait_ms = 15000;

const guests = new Map<string, BrowserGuest>();
let mount_count = 0;
let partition: Promise<string> | null = null;
let command_queue: Promise<void> = Promise.resolve();

const error_text = (error: unknown) => (error instanceof Error ? error.message : String(error));

const find_tab = (tab_id: string) => browser_store.get().tabs.find((tab) => tab.id === tab_id) ?? null;

export const browser_partition = (): Promise<string> => {
  partition ??= api.invoke("browser:partition").catch((error: unknown) => {
    partition = null;
    throw error;
  });
  return partition;
};

export const patch_browser_tab = (tab_id: string, patch: Partial<BrowserTab>) =>
  browser_store.update((state) => ({ ...state, tabs: state.tabs.map((tab) => (tab.id === tab_id ? { ...tab, ...patch } : tab)) }));

export const add_browser_tab = (url = "about:blank", tab_id = `browser-${crypto.randomUUID()}`): string => {
  if (find_tab(tab_id)) {
    browser_store.update((state) => ({ ...state, active_id: tab_id }));
    return tab_id;
  }
  const tab: BrowserTab = {
    id: tab_id,
    initial_url: url,
    url,
    draft: null,
    title: "",
    loading: false,
    can_back: false,
    can_forward: false,
    error: "",
    registered: false,
  };
  browser_store.update((state) => ({ ...state, tabs: [...state.tabs, tab], active_id: tab_id }));
  return tab_id;
};

export const select_browser_tab = (tab_id: string) => {
  if (find_tab(tab_id)) {
    browser_store.update((state) => ({ ...state, active_id: tab_id }));
  }
};

export const close_browser_tab = (tab_id: string) =>
  browser_store.update((state) => {
    const index = state.tabs.findIndex((tab) => tab.id === tab_id);
    if (index === -1) {
      return state;
    }
    const tabs = state.tabs.filter((tab) => tab.id !== tab_id);
    const active_id = state.active_id === tab_id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? "") : state.active_id;
    return { ...state, tabs, active_id };
  });

const confirm_active = async (tab_id: string) => {
  try {
    await api.invoke("browser:set_active_tab", tab_id || null);
  } catch (error) {
    console.error(`[browser] browser:set_active_tab failed for tab ${tab_id || "none"}`, error);
    return;
  }
  const state = browser_store.get();
  if (state.active_id === tab_id && (tab_id === "" || find_tab(tab_id)?.registered)) {
    browser_store.set({ ...state, confirmed_id: tab_id });
  }
};

const attached_contents_id = (guest: BrowserGuest): number | null => {
  try {
    return guest.getWebContentsId();
  } catch (error) {
    console.debug("[browser] guest is not attached yet", error);
    return null;
  }
};

export const register_guest = async (tab_id: string, guest: BrowserGuest) => {
  const web_contents_id = attached_contents_id(guest);
  if (web_contents_id === null) {
    return;
  }
  guests.set(tab_id, guest);
  try {
    const accepted = await api.invoke("browser:register_tab", { tab_id, web_contents_id, url: find_tab(tab_id)?.url ?? "" });
    if (!accepted) {
      throw new Error("main refused the guest");
    }
  } catch (error) {
    console.error(`[browser] browser:register_tab failed for tab ${tab_id}`, error);
    guests.delete(tab_id);
    patch_browser_tab(tab_id, { error: error_text(error) });
    return;
  }
  if (guests.get(tab_id) !== guest) {
    return;
  }
  patch_browser_tab(tab_id, { registered: true });
  if (browser_store.get().active_id === tab_id) {
    await confirm_active(tab_id);
  }
};

export const unregister_guest = (tab_id: string, guest: BrowserGuest) => {
  if (guests.get(tab_id) !== guest) {
    return;
  }
  guests.delete(tab_id);
  browser_store.update((state) => ({
    ...state,
    confirmed_id: state.confirmed_id === tab_id ? "" : state.confirmed_id,
    tabs: state.tabs.map((tab) => (tab.id === tab_id ? { ...tab, registered: false } : tab)),
  }));
  api.invoke("browser:unregister_tab", tab_id).catch((error) => console.error(`[browser] browser:unregister_tab failed for tab ${tab_id}`, error));
};

export const run_guest = (tab_id: string, action: (guest: BrowserGuest) => void): boolean => {
  const guest = guests.get(tab_id);
  if (!guest || !find_tab(tab_id)?.registered) {
    return false;
  }
  action(guest);
  return true;
};

export const load_browser_url = (tab_id: string, url: string): boolean => {
  const loaded = run_guest(tab_id, (guest) => {
    guest.loadURL(url).catch((error) => console.error(`[browser] loading ${url} in tab ${tab_id} failed`, error));
  });
  if (loaded) {
    patch_browser_tab(tab_id, { draft: null, error: "" });
  }
  return loaded;
};

const reset_browser = () => {
  guests.clear();
  browser_store.set({ tabs: [], active_id: "", confirmed_id: "", mounted: false });
  api.invoke("browser:wipe").catch((error) => console.error("[browser] browser:wipe failed", error));
};

export const mount_browser = (): (() => void) => {
  mount_count += 1;
  if (!browser_store.get().mounted) {
    browser_store.update((state) => ({ ...state, mounted: true }));
  }
  return () => {
    mount_count -= 1;
    window.setTimeout(() => {
      if (mount_count === 0) {
        reset_browser();
      }
    }, 0);
  };
};

const open_browser_dock = () => {
  if (ui_store.get().dock.kind !== "browser") {
    toggle_dock("browser");
  }
};

const wait_for = (predicate: (state: BrowserState) => boolean, failure: string) =>
  new Promise<void>((resolve, reject) => {
    const check = () => {
      if (!predicate(browser_store.get())) {
        return;
      }
      stop();
      window.clearTimeout(timer);
      resolve();
    };
    const stop = browser_store.subscribe(check);
    const timer = window.setTimeout(() => {
      stop();
      reject(new Error(failure));
    }, command_wait_ms);
    check();
  });

const active_and_confirmed = (tab_id: string) => (state: BrowserState) =>
  state.active_id === tab_id && state.confirmed_id === tab_id && Boolean(state.tabs.find((tab) => tab.id === tab_id)?.registered);

const run_command = async (command: BrowserCommand): Promise<string | null> => {
  switch (command.action) {
    case "new": {
      const tab_id = add_browser_tab(command.url || "about:blank");
      open_browser_dock();
      await wait_for(active_and_confirmed(tab_id), `Browser tab ${tab_id} did not attach in time.`);
      return tab_id;
    }
    case "select":
      if (!find_tab(command.tab_id)) {
        throw new Error(`Browser tab ${command.tab_id} is not open.`);
      }
      select_browser_tab(command.tab_id);
      open_browser_dock();
      await wait_for(active_and_confirmed(command.tab_id), `Browser tab ${command.tab_id} could not be activated.`);
      return command.tab_id;
    case "close":
      close_browser_tab(command.tab_id);
      await wait_for((state) => !state.tabs.some((tab) => tab.id === command.tab_id), `Browser tab ${command.tab_id} is still open.`);
      return command.tab_id;
    case "open_panel":
      open_browser_dock();
      await wait_for((state) => state.mounted, "The browser panel did not open in time.");
      return null;
  }
};

const answer = (result: BrowserCommandResult) =>
  api.invoke("browser:command_result", result).catch((error) => console.error(`[browser] browser:command_result failed for ${result.command_id}`, error));

const handle_command = async (command: BrowserCommand) => {
  try {
    const tab_id = await run_command(command);
    await answer({ command_id: command.command_id, ok: true, tab_id, error: null });
  } catch (error) {
    console.error(`[browser] command ${command.action} (${command.command_id}) failed`, error);
    await answer({ command_id: command.command_id, ok: false, tab_id: null, error: error_text(error) });
  }
};

export const init_browser = (): (() => void) => {
  let active_id = browser_store.get().active_id;
  const stop_active = browser_store.subscribe(() => {
    const state = browser_store.get();
    if (state.active_id === active_id) {
      return;
    }
    active_id = state.active_id;
    browser_store.set({ ...state, confirmed_id: "" });
    if (state.active_id === "" || find_tab(state.active_id)?.registered) {
      void confirm_active(state.active_id);
    }
  });
  const stop_commands = api.on("browser:command", (command) => {
    command_queue = command_queue.then(() => handle_command(command));
  });
  const stop_popups = api.on("browser:popup", ({ url }) => {
    if (browser_store.get().mounted && url && url !== "about:blank") {
      add_browser_tab(url);
    }
  });
  return () => {
    stop_active();
    stop_commands();
    stop_popups();
  };
};
