import { draft_browser_chat, type BrowserChatTabs, type BrowserHistoryAction, type BrowserTabInfo, type BrowserViewport } from "../../shared/ipc/browser.ts";
import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";

export type BrowserState = { chats: Record<string, BrowserChatTabs>; drafts: Record<string, string> };

export const browser_store = create_store<BrowserState>({ chats: {}, drafts: {} });

export const no_browser_tabs: BrowserTabInfo[] = [];

const editing = { tab_id: "" };

const opening = new Set<string>();

export const browser_chat_key = (chat_id: string | null) => chat_id ?? draft_browser_chat;

const kept_drafts = (drafts: Record<string, string>, previous: BrowserChatTabs | undefined, next: BrowserChatTabs) => {
  const urls = new Map(next.tabs.map((tab) => [tab.tab_id, tab.url]));
  const before = new Map((previous?.tabs ?? []).map((tab) => [tab.tab_id, tab.url]));
  const kept: Record<string, string> = {};
  for (const [tab_id, draft] of Object.entries(drafts)) {
    const owned = before.has(tab_id) || urls.has(tab_id);
    if (!owned) {
      kept[tab_id] = draft;
      continue;
    }
    const navigated = before.get(tab_id) !== urls.get(tab_id);
    if (urls.has(tab_id) && (!navigated || editing.tab_id === tab_id)) {
      kept[tab_id] = draft;
    }
  }
  return kept;
};

export const apply_browser_tabs = (next: BrowserChatTabs) =>
  browser_store.update((state) => ({
    chats: { ...state.chats, [next.chat_id]: next },
    drafts: kept_drafts(state.drafts, state.chats[next.chat_id], next),
  }));

export const sync_browser = async (chat_key: string) => {
  try {
    apply_browser_tabs(await api.invoke("browser:tabs", chat_key));
  } catch (error) {
    console.error(`[browser] browser:tabs failed for chat ${chat_key || "draft"}`, error);
  }
};

export const open_browser_tab = async (chat_key: string, url = "about:blank") => {
  try {
    await api.invoke("browser:open", chat_key, url);
  } catch (error) {
    console.error(`[browser] browser:open failed for chat ${chat_key || "draft"} and ${url}`, error);
  }
  await sync_browser(chat_key);
};

export const ensure_browser_tab = async (chat_key: string) => {
  const chat = browser_store.get().chats[chat_key];
  if (!chat || chat.tabs.length > 0 || opening.has(chat_key)) {
    return;
  }
  opening.add(chat_key);
  try {
    await open_browser_tab(chat_key);
  } finally {
    opening.delete(chat_key);
  }
};

const run = async (label: string, chat_key: string, tab_id: string, work: () => Promise<void>) => {
  try {
    await work();
  } catch (error) {
    console.error(`[browser] ${label} failed for tab ${tab_id} in chat ${chat_key || "draft"}`, error);
    await sync_browser(chat_key);
  }
};

export const close_browser_tab = (chat_key: string, tab_id: string) => run("browser:close", chat_key, tab_id, () => api.invoke("browser:close", chat_key, tab_id));

export const select_browser_tab = (chat_key: string, tab_id: string) => run("browser:select", chat_key, tab_id, () => api.invoke("browser:select", chat_key, tab_id));

export const browser_history = (chat_key: string, tab_id: string, action: BrowserHistoryAction) =>
  run(`browser:history ${action}`, chat_key, tab_id, () => api.invoke("browser:history", chat_key, tab_id, action));

export const set_browser_draft = (tab_id: string, draft: string | null) =>
  browser_store.update((state) => {
    const drafts = { ...state.drafts };
    if (draft === null) {
      delete drafts[tab_id];
    } else {
      drafts[tab_id] = draft;
    }
    return { ...state, drafts };
  });

export const set_browser_editing = (tab_id: string) => {
  editing.tab_id = tab_id;
};

export const load_browser_url = (chat_key: string, tab_id: string, url: string) => {
  set_browser_draft(tab_id, null);
  return run("browser:load", chat_key, tab_id, () => api.invoke("browser:load", chat_key, tab_id, url));
};

export const send_browser_viewport = (viewport: BrowserViewport) => api.send("browser:viewport", viewport);

export const freeze_browser = async (chat_key: string): Promise<string | null> => {
  try {
    return await api.invoke("browser:freeze", chat_key);
  } catch (error) {
    console.error(`[browser] browser:freeze failed for chat ${chat_key || "draft"}`, error);
    return null;
  }
};

export const init_browser = (): (() => void) => api.on("browser:changed", apply_browser_tabs);
