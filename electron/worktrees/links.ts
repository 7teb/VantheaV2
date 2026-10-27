import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { error_code, error_text, missing_path } from "../storage/coerce.ts";

const busy_codes = new Set(["EBUSY", "EPERM", "ENOTEMPTY"]);

const busy_delays = [200, 400, 800, 1600, 3200];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const lstat_optional = async (target: string): Promise<Stats | null> => {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (missing_path(error)) {
      return null;
    }
    throw error;
  }
};

export const link_node_modules = async (main_dir: string, chat_dir: string): Promise<boolean> => {
  const source = path.join(main_dir, "node_modules");
  const link = path.join(chat_dir, "node_modules");
  const info = await lstat_optional(source);
  if (!info || info.isSymbolicLink() || !info.isDirectory() || (await lstat_optional(link))) {
    return false;
  }
  await fs.symlink(source, link, "junction");
  return true;
};

const remove_link = async (target: string) => {
  try {
    await fs.rmdir(target);
  } catch (error) {
    if (error_code(error) !== "ENOTDIR" && error_code(error) !== "ENOENT") {
      throw error;
    }
    await fs.unlink(target).catch((unlink_error: unknown) => {
      if (error_code(unlink_error) !== "ENOENT") {
        throw unlink_error;
      }
    });
  }
};

const remove_file = async (target: string) => {
  try {
    await fs.unlink(target);
  } catch (error) {
    if (error_code(error) !== "EPERM") {
      throw error;
    }
    await fs.chmod(target, 0o666);
    await fs.unlink(target);
  }
};

export const remove_tree = async (target: string): Promise<void> => {
  const info = await lstat_optional(target);
  if (!info) {
    return;
  }
  if (info.isSymbolicLink()) {
    await remove_link(target);
    return;
  }
  if (!info.isDirectory()) {
    await remove_file(target);
    return;
  }
  for (const name of await fs.readdir(target)) {
    await remove_tree(path.join(target, name));
  }
  await fs.rmdir(target);
};

export const retry_busy = async <T>(what: string, run: () => Promise<T>): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const delay = busy_delays[attempt];
      if (delay === undefined || !busy_codes.has(error_code(error))) {
        throw new Error(`${what} failed: ${error_text(error)}`, { cause: error });
      }
      await sleep(delay);
    }
  }
};
