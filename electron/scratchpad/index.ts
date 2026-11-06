import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { is_inside } from "../project/scope.ts";

export type ScratchPath = { root: string; relative: string };

const folders = new Map<string, string>();

const base = () => path.join(os.tmpdir(), "VantheaX", "scratchpad");

export const open_scratchpad = async (chat_id: string): Promise<string> => {
  const folder = folders.get(chat_id) ?? path.join(base(), randomUUID());
  folders.set(chat_id, folder);
  await fs.mkdir(folder, { recursive: true });
  return fs.realpath(folder);
};

export const scratch_path = async (chat_id: string, requested: string): Promise<ScratchPath | null> => {
  if (!path.win32.isAbsolute(requested)) {
    return null;
  }

  const root = await open_scratchpad(chat_id);
  const target = path.resolve(requested);
  if (!is_inside(root, target)) {
    return null;
  }

  return { root, relative: path.relative(root, target) };
};

export const remove_scratchpad = async (chat_id: string): Promise<void> => {
  const folder = folders.get(chat_id);
  if (!folder) {
    return;
  }

  folders.delete(chat_id);
  await fs.rm(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
};

export const close_scratchpads = (): void => {
  for (const folder of folders.values()) {
    try {
      rmSync(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (error) {
      console.error(`[scratchpad] removing ${folder} while the app closes failed:`, error);
    }
  }

  folders.clear();
};
