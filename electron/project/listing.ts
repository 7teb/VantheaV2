import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { DirEntry, DirListing, FileMatches } from "../../shared/ipc/files.ts";
import { error_text } from "../storage/coerce.ts";
import { ignored_dirs, project_index } from "./index.ts";
import { is_inside, resolve_inside, to_posix } from "./scope.ts";

type EntryKind = DirEntry["kind"];

export const max_dir_entries = 2000;

export const max_matches = 300;

const names = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export const tree_path = (value: string): string =>
  to_posix(value)
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");

const base_name = (file: string) => file.slice(file.lastIndexOf("/") + 1);

const link_kind = async (root: string, absolute: string): Promise<EntryKind | null> => {
  try {
    const real = await fs.realpath(absolute);
    if (!is_inside(root, real)) {
      return null;
    }
    const stat = await fs.stat(real);
    if (stat.isDirectory()) {
      return "dir";
    }
    return stat.isFile() ? "file" : null;
  } catch (error) {
    console.warn(`[files] resolving link ${absolute} failed: ${error_text(error)}`);
    return null;
  }
};

const entry_kind = async (root: string, dir: string, item: Dirent): Promise<EntryKind | null> => {
  if (item.isDirectory()) {
    return "dir";
  }
  if (item.isFile()) {
    return "file";
  }
  return item.isSymbolicLink() ? link_kind(root, path.join(dir, item.name)) : null;
};

const by_kind_then_name = (a: DirEntry, b: DirEntry) => {
  if (a.kind !== b.kind) {
    return a.kind === "dir" ? -1 : 1;
  }
  return names.compare(a.name, b.name);
};

export const list_dir = async (project_root: string, relative: string): Promise<DirListing> => {
  const dir = tree_path(relative);
  const scoped = await resolve_inside(project_root, dir || ".");
  const items = await fs.readdir(scoped.target, { withFileTypes: true });
  const kinds = await Promise.all(items.map((item) => entry_kind(scoped.root, scoped.target, item)));
  const entries = items
    .flatMap((item, index): DirEntry[] => {
      const kind = kinds[index];
      if (!kind || (kind === "dir" && ignored_dirs.has(item.name))) {
        return [];
      }
      return [{ name: item.name, path: dir ? `${dir}/${item.name}` : item.name, kind }];
    })
    .sort(by_kind_then_name);
  return { path: dir, entries: entries.slice(0, max_dir_entries), more: Math.max(0, entries.length - max_dir_entries) };
};

const by_match = (needle: string) => (a: string, b: string) => {
  const a_prefix = base_name(a).toLowerCase().startsWith(needle);
  const b_prefix = base_name(b).toLowerCase().startsWith(needle);
  if (a_prefix !== b_prefix) {
    return a_prefix ? -1 : 1;
  }
  if (a.length !== b.length) {
    return a.length - b.length;
  }
  return names.compare(a, b);
};

export const find_files = async (project_root: string, query: string): Promise<FileMatches> => {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return { paths: [], truncated: false };
  }
  const index = await project_index(project_root, "human");
  const matches = index.files
    .map((file) => file.path)
    .filter((file) => base_name(file).toLowerCase().includes(needle))
    .sort(by_match(needle));
  return { paths: matches.slice(0, max_matches), truncated: index.truncated || matches.length > max_matches };
};
