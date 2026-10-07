const explicit_scheme = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const loopback_host = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#].*)?$/i;
const host_with_port = /^(?:\[[0-9A-Fa-f:]+\]|[^/\s:]+):\d+(?:[/?#].*)?$/;
const dotted_host = /^[^\s.]+(?:\.[^\s.]+)+(?:[/?#].*)?$/;

export const display_browser_url = (value: string) => (value === "about:blank" ? "" : value);

export const normalize_browser_url = (value: string): string | null => {
  const input = value.trim();
  if (!input) {
    return null;
  }
  if (/^https?:\/\//i.test(input)) {
    if (!URL.canParse(input)) {
      return null;
    }
    const protocol = new URL(input).protocol;
    return protocol === "http:" || protocol === "https:" ? input : null;
  }
  if (input === "about:blank") {
    return input;
  }
  if (loopback_host.test(input)) {
    return `http://${input}`;
  }
  if (host_with_port.test(input)) {
    return `https://${input}`;
  }
  if (explicit_scheme.test(input)) {
    return null;
  }
  if (dotted_host.test(input)) {
    return `https://${input}`;
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(input)}`;
};

export const tab_label = (title: string, url: string, fallback: string) => {
  if (title.trim()) {
    return title.trim();
  }
  if (!URL.canParse(url) || url === "about:blank") {
    return fallback;
  }
  return new URL(url).host || fallback;
};
