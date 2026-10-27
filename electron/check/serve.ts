import fs from "node:fs/promises";
import path from "node:path";
import { is_secret_path } from "../../shared/secret-path.ts";
import { resolve_inside } from "../project/scope.ts";
import { error_text } from "../storage/coerce.ts";

export type ServedFolder = { folder: string; project_root: string };

const served = new Map<string, ServedFolder>();

const text_types: Record<string, string> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".txt": "text/plain",
};

const binary_types: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

const content_type = (file: string): string => {
  const extension = path.extname(file).toLowerCase();
  const text = text_types[extension];
  return text ? `${text}; charset=utf-8` : (binary_types[extension] ?? "application/octet-stream");
};

export const serve_folder = (token: string, folder: ServedFolder) => {
  served.set(token, folder);
};

export const stop_serving = (token: string) => {
  served.delete(token);
};

const refuse = (request: Request, reason: string, status = 404) => {
  console.warn(`[check] refused ${request.method} ${request.url.slice(0, 300)}: ${reason}`);
  return new Response(null, { status });
};

const served_file = async (folder: ServedFolder, pathname: string): Promise<string> => {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  const scoped = await resolve_inside(folder.folder, relative);
  if (is_secret_path(path.relative(folder.project_root, scoped.target))) {
    throw new Error("secret file path");
  }
  if (!(await fs.stat(scoped.target)).isFile()) {
    throw new Error("not a file");
  }
  return scoped.target;
};

export const serve_check_request = async (request: Request): Promise<Response> => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return refuse(request, "method not allowed", 405);
  }
  const url = new URL(request.url);
  const folder = served.get(url.hostname);
  if (!folder) {
    return refuse(request, "no check is running for this address");
  }
  try {
    const file = await served_file(folder, url.pathname);
    const data = await fs.readFile(file);
    const headers = {
      "Content-Type": content_type(file),
      "Content-Length": String(data.length),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    return new Response(request.method === "HEAD" ? null : data, { status: 200, headers });
  } catch (error) {
    return refuse(request, error_text(error));
  }
};
