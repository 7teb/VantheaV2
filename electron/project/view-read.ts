import fs from "node:fs/promises";
import { max_view_bytes, type FileView } from "../../shared/ipc/files.ts";
import { missing_path } from "../storage/coerce.ts";
import { decode_text, looks_binary, read_head } from "../storage/text-codec.ts";
import { tree_path } from "./listing.ts";
import { resolve_inside, type ScopedPath } from "./scope.ts";

const scoped_file = async (project_root: string, file: string): Promise<ScopedPath | null> => {
  try {
    return await resolve_inside(project_root, file);
  } catch (error) {
    if (missing_path(error) || (error instanceof Error && missing_path(error.cause))) {
      return null;
    }
    throw error;
  }
};

const whole_lines = (text: string) => {
  const end = text.lastIndexOf("\n");
  return end < 0 ? text : text.slice(0, end + 1);
};

export const read_for_view = async (project_root: string, relative: string): Promise<FileView> => {
  const file = tree_path(relative);
  if (!file) {
    throw new Error("a file path is required");
  }
  const scoped = await scoped_file(project_root, file);
  if (!scoped) {
    return { kind: "missing", path: file };
  }
  const stat = await fs.stat(scoped.target);
  if (!stat.isFile()) {
    throw new Error(`${file} is not a file`);
  }
  const bytes = await read_head(scoped.target, Math.min(stat.size, max_view_bytes));
  const { text } = decode_text(bytes);
  if (looks_binary(text)) {
    return { kind: "binary", path: file, size: stat.size };
  }
  const truncated = stat.size > bytes.length;
  const shown = truncated ? whole_lines(text) : text;
  return { kind: "text", path: file, size: stat.size, text: shown.replace(/\r\n?/g, "\n"), truncated };
};
