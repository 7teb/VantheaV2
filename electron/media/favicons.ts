import fs from "node:fs/promises";
import path from "node:path";
import { error_code, error_text } from "../storage/coerce.ts";
import { write_file_atomic } from "../storage/json-file.ts";

const host_pattern = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

let dir: string | null = null;

const missing = new Set<string>();

const loading = new Map<string, Promise<Buffer | null>>();

export const init_favicons = (value: string) => {
  dir = value;
};

export const is_favicon_host = (value: string): boolean => host_pattern.test(value);

const favicon_file = (host: string): string => {
  if (!dir) {
    throw new Error("favicons used before init_favicons");
  }
  return path.join(dir, `${host}.png`);
};

const download = async (host: string): Promise<Buffer | null> => {
  const response = await fetch(`https://www.google.com/s2/favicons?domain=${host}&sz=32`, { signal: AbortSignal.timeout(10000) });
  if (response.status === 404) {
    missing.add(host);
    return null;
  }
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || type !== "image/png") {
    throw new Error(`HTTP ${response.status} ${type}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  await write_file_atomic(favicon_file(host), data);
  return data;
};

const cached = async (host: string): Promise<Buffer | null> => {
  try {
    return await fs.readFile(favicon_file(host));
  } catch (error) {
    if (error_code(error) !== "ENOENT") {
      throw error;
    }
    return null;
  }
};

export const favicon_png = async (host: string): Promise<Buffer | null> => {
  if (missing.has(host)) {
    return null;
  }
  const stored = await cached(host);
  if (stored) {
    return stored;
  }
  const running = loading.get(host);
  if (running) {
    return running;
  }
  const started = download(host)
    .catch((error: unknown) => {
      console.warn(`[media] favicon for ${host} could not be loaded: ${error_text(error)}`);
      return null;
    })
    .finally(() => loading.delete(host));
  loading.set(host, started);
  return started;
};
