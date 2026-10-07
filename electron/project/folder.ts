import fs from "node:fs/promises";
import path from "node:path";
import { error_text } from "../storage/coerce.ts";

export const read_folder_id = async (dir: string): Promise<string> => {
  const stat = await fs.stat(dir, { bigint: true });
  if (!stat.isDirectory()) {
    throw new Error(`${dir} is not a directory`);
  }
  return `${stat.dev}:${stat.ino}`;
};

export const find_renamed = async (old_path: string, folder_id: string): Promise<string | null> => {
  const parent = path.dirname(old_path);
  const skipped: string[] = [];
  for (const entry of await fs.readdir(parent, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(parent, entry.name);
    try {
      if ((await read_folder_id(candidate)) === folder_id) {
        return candidate;
      }
    } catch (error) {
      skipped.push(`${entry.name} (${error_text(error)})`);
    }
  }
  const unreadable = skipped.length ? `, unreadable folders skipped: ${skipped.join(", ")}` : "";
  console.warn(`[projects] ${old_path} is missing and no folder in ${parent} has its folder id${unreadable}`);
  return null;
};
