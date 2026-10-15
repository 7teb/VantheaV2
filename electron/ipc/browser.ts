import type { BrowserHistoryAction, BrowserRect, BrowserViewport } from "../../shared/ipc/browser.ts";
import { freeze_frame, set_viewport } from "../browser/dock.ts";
import { is_guest_url_allowed } from "../browser/guest-policy.ts";
import { chat_state, close_tab, load_url, open_user_tab, select_tab, step_tab_history } from "../browser/tabs.ts";
import { handle, listen } from "./handle.ts";

const id_limit = 200;

const history_actions: readonly BrowserHistoryAction[] = ["back", "forward", "reload"];

const chat_text = (value: unknown) => {
  if (typeof value !== "string" || value.length > id_limit) {
    throw new Error("chat_id must be a string");
  }
  return value;
};

const tab_text = (value: unknown) => {
  if (typeof value !== "string" || !value || value.length > id_limit) {
    throw new Error("tab_id must be a non-empty string");
  }
  return value;
};

const url_text = (value: unknown) => {
  if (typeof value !== "string" || !is_guest_url_allowed(value, true)) {
    throw new Error("url must be an http or https address or about:blank");
  }
  return value;
};

const history_action = (value: unknown) => {
  if (!history_actions.includes(value as BrowserHistoryAction)) {
    throw new Error(`action must be one of ${history_actions.join(", ")}`);
  }
  return value as BrowserHistoryAction;
};

const finite = (value: unknown, field: string) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
};

const valid_rect = (value: unknown): BrowserRect | null => {
  if (value === null) {
    return null;
  }
  const rect = (value ?? {}) as Record<string, unknown>;
  const parsed = { x: finite(rect.x, "rect.x"), y: finite(rect.y, "rect.y"), width: finite(rect.width, "rect.width"), height: finite(rect.height, "rect.height") };
  return parsed.width >= 1 && parsed.height >= 1 ? parsed : null;
};

const valid_viewport = (value: unknown): BrowserViewport => {
  const viewport = (value ?? {}) as Record<string, unknown>;
  return { chat_id: chat_text(viewport.chat_id), rect: valid_rect(viewport.rect), radius: Math.max(0, finite(viewport.radius, "radius")) };
};

export const register_browser_ipc = () => {
  handle("browser:tabs", (chat_id) => chat_state(chat_text(chat_id)));
  handle("browser:open", (chat_id, url) => open_user_tab(chat_text(chat_id), url_text(url)).tab_id);
  handle("browser:close", (chat_id, tab_id) => close_tab(chat_text(chat_id), tab_text(tab_id)));
  handle("browser:select", (chat_id, tab_id) => {
    select_tab(chat_text(chat_id), tab_text(tab_id));
  });
  handle("browser:load", (chat_id, tab_id, url) => load_url(chat_text(chat_id), tab_text(tab_id), url_text(url)));
  handle("browser:history", (chat_id, tab_id, action) => step_tab_history(chat_text(chat_id), tab_text(tab_id), history_action(action)));
  handle("browser:freeze", (chat_id) => freeze_frame(chat_text(chat_id)));
  listen("browser:viewport", (viewport) => set_viewport(valid_viewport(viewport)));
};
