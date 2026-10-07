export const browser_partition = "vx-browser";

export const plain_user_agent = (user_agent: string, app_name: string): string => {
  const escaped = app_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokens = escaped ? `(?:${escaped}|Electron)` : "Electron";
  return user_agent
    .replace(new RegExp(`\\s${tokens}\\/\\S+`, "g"), "")
    .replace(/\s{2,}/g, " ")
    .trim();
};

export const is_guest_url_allowed = (value: string, allow_blank: boolean): boolean => {
  if (allow_blank && value === "about:blank") {
    return true;
  }
  if (!URL.canParse(value)) {
    return false;
  }
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
};

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
