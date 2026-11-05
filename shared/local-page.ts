import { is_secret_path } from "./secret-path.ts";

const drive_path = /^[A-Za-z]:[\\/]/;

const page_extension = /\.(?:html?|xhtml|svg)$/i;

const file_url_of = (path: string): string => {
  const [drive = "", ...parts] = path.replaceAll("\\", "/").split("/");
  return `file:///${[drive.toUpperCase(), ...parts.map((part) => encodeURIComponent(part))].join("/")}`;
};

export const is_local_target = (value: string): boolean => drive_path.test(value.trim()) || /^file:/i.test(value.trim());

const local_path = (url: URL): string | null => {
  if (url.protocol !== "file:" || url.host !== "") {
    return null;
  }
  try {
    const path = decodeURIComponent(url.pathname).slice(1);
    return drive_path.test(path) ? path : null;
  } catch (error) {
    console.warn(`[browser] ${url.href.slice(0, 200)} has an invalid escape in its path: ${String(error)}`);
    return null;
  }
};

export const is_local_page = (value: string): boolean => {
  if (!URL.canParse(value)) {
    return false;
  }
  const path = local_path(new URL(value));
  return path !== null && page_extension.test(path) && !is_secret_path(path);
};

export const local_page_url = (value: string): string | null => {
  const raw = value.trim();
  const candidate = drive_path.test(raw) ? file_url_of(raw) : raw;
  if (!is_local_page(candidate)) {
    return null;
  }
  return new URL(candidate).href;
};

export const local_page_path = (value: string): string | null => (URL.canParse(value) ? local_path(new URL(value)) : null);

export const local_page_name = (value: string): string | null => local_page_path(value)?.split("/").pop() ?? null;
