export type FileLinkTarget = { kind: "project"; path: string } | { kind: "outside"; path: string };

const absolute_path = /^([a-z]:\/|\/\/)/i;

const decoded = (href: string): string => {
  try {
    return decodeURIComponent(href);
  } catch (error) {
    console.warn(`[files] file link ${href.slice(0, 200)} is not valid percent-encoding, reading it as written`, error);
    return href;
  }
};

const normalized = (path: string): string => {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      if (parts.length > 1) {
        parts.pop();
      }
      continue;
    }
    parts.push(part);
  }
  return `${path.startsWith("//") ? "//" : ""}${parts.join("/")}`;
};

const link_path = (href: string): string =>
  decoded(href)
    .trim()
    .replace(/^file:\/\/\/?/i, "")
    .replace(/#.*$/, "")
    .replace(/:\d+(?::\d+)?$/, "")
    .replace(/\\/g, "/")
    .replace(/^\/(?=[a-z]:\/)/i, "");

export const file_link_target = (href: string, root: string | null): FileLinkTarget | null => {
  const path = link_path(href);
  if (!path) {
    return null;
  }
  const home = root === null ? null : normalized(root.replace(/\\/g, "/"));
  const absolute = absolute_path.test(path);
  if (!absolute && home === null) {
    return null;
  }
  const full = normalized(absolute ? path : `${home}/${path}`);
  if (home !== null && full.toLowerCase().startsWith(`${home.toLowerCase()}/`)) {
    return { kind: "project", path: full.slice(home.length + 1) };
  }
  return { kind: "outside", path: full.replace(/\//g, "\\") };
};
