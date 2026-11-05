import { is_local_page, is_local_target, local_page_url } from "../../shared/local-page.ts";

export const chat_partition = (chat_id: string) => `vx-browser-chat-${chat_id}`;

export const draft_partition = (seq: number) => `vx-browser-draft-${seq}`;

export const plain_user_agent = (user_agent: string, app_name: string): string => {
  const escaped = app_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokens = escaped ? `(?:${escaped}|Electron)` : "Electron";
  return user_agent
    .replace(new RegExp(`\\s${tokens}\\/\\S+`, "g"), "")
    .replace(/\s{2,}/g, " ")
    .trim();
};

export const is_web_url = (value: string): boolean => {
  if (!URL.canParse(value)) {
    return false;
  }
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
};

export const is_guest_url_allowed = (value: string, allow_blank: boolean): boolean =>
  (allow_blank && value === "about:blank") || is_web_url(value) || is_local_page(value);

export const crosses_into_files = (from: string, to: string): boolean => /^file:/i.test(to) && !/^file:/i.test(from);

export const normalize_browser_page = (value: string): string | null => (is_local_target(value) ? local_page_url(value) : normalize_browser_target(value));

const loopback = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#].*)?$/i;

const host_with_port = /^(?:\[[0-9A-Fa-f:]+\]|[^/\s:]+):\d+(?:[/?#].*)?$/;

export const normalize_browser_target = (value: string): string | null => {
  const raw = value.trim();
  if (!raw) {
    return null;
  }
  if (raw === "about:blank") {
    return raw;
  }
  if (loopback.test(raw)) {
    return `http://${raw}`;
  }
  if (host_with_port.test(raw)) {
    return `https://${raw}`;
  }
  if (/\s/.test(raw) && !/^https?:\/\//i.test(raw)) {
    return `https://duckduckgo.com/?q=${encodeURIComponent(raw)}`;
  }
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  if (!URL.canParse(candidate)) {
    return null;
  }
  const url = new URL(candidate);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  return url.toString().replace(/\/$/, "");
};
