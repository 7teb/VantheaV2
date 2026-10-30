import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { error_code } from "../storage/coerce.ts";

export type StaticFile = { status: 200; body: Buffer; type: string; cache: string; html: boolean } | { status: 404 } | { status: 503 };

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

const no_store = new Set(["index.html", "visual-frame.html"]);

export const static_root = (): string => path.join(app.getAppPath(), "dist");

export const static_relative = (pathname: string): string | null => {
  let decoded = "";
  try {
    decoded = decodeURIComponent(pathname);
  } catch (error) {
    console.warn(`[remote] refused a static path that does not decode (${error instanceof Error ? error.message : String(error)}): ${pathname.slice(0, 200)}`);
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) {
    return null;
  }
  const segments = decoded.split("/").filter(Boolean);
  if (segments.some((segment) => segment === ".." || segment === ".")) {
    return null;
  }
  return segments.length ? segments.join("/") : "index.html";
};

const cache_of = (relative: string) => {
  if (no_store.has(relative)) {
    return "no-store";
  }
  return relative.startsWith("assets/") ? "private, max-age=31536000, immutable" : "no-cache";
};

export const read_static = async (root: string, pathname: string): Promise<StaticFile> => {
  const relative = static_relative(pathname);
  const type = relative ? types[path.extname(relative).toLowerCase()] : undefined;
  if (!relative || !type) {
    return { status: 404 };
  }
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep)) {
    return { status: 404 };
  }
  try {
    const body = await fs.readFile(target);
    return { status: 200, body, type, cache: cache_of(relative), html: type.startsWith("text/html") };
  } catch (error) {
    const code = error_code(error);
    if (relative === "index.html" && code === "ENOENT") {
      return { status: 503 };
    }
    if (code !== "ENOENT" && code !== "EISDIR" && code !== "ENOTDIR") {
      console.error(`[remote] reading the static file ${target} failed:`, error);
    }
    return { status: 404 };
  }
};
