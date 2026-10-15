import { emit, invoke, send } from "./channel.ts";

export const draft_browser_chat = "";

export type BrowserTabInfo = {
  tab_id: string;
  url: string;
  title: string;
  loading: boolean;
  can_back: boolean;
  can_forward: boolean;
  error: string;
  crashed: boolean;
};

export type BrowserChatTabs = { chat_id: string; tabs: BrowserTabInfo[]; active_id: string };

export type BrowserRect = { x: number; y: number; width: number; height: number };

export type BrowserViewport = { chat_id: string; rect: BrowserRect | null; radius: number };

export type BrowserHistoryAction = "back" | "forward" | "reload";

export const browser_channels = {
  "browser:tabs": invoke<[chat_id: string], BrowserChatTabs>(),
  "browser:open": invoke<[chat_id: string, url: string], string>(),
  "browser:close": invoke<[chat_id: string, tab_id: string], void>(),
  "browser:select": invoke<[chat_id: string, tab_id: string], void>(),
  "browser:load": invoke<[chat_id: string, tab_id: string, url: string], void>(),
  "browser:history": invoke<[chat_id: string, tab_id: string, action: BrowserHistoryAction], void>(),
  "browser:freeze": invoke<[chat_id: string], string | null>(),
  "browser:viewport": send<[viewport: BrowserViewport]>(),
  "browser:changed": emit<BrowserChatTabs>(),
} as const;
