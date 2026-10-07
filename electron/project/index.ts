import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { error_text } from "../storage/coerce.ts";
import { path_key } from "../storage/paths.ts";
import { is_inside, is_secret_path, project_real_root, to_posix } from "./scope.ts";

export type IndexEntry = { path: string; size: number };

export type ProjectWalk = { files: IndexEntry[]; directories: string[]; truncated: boolean };

export type ProjectIndex = ProjectWalk & { root: string; built_at: number };

const ignored_dirs = new Set([".git", "node_modules", "dist", "build", ".vs", ".idea", ".vscode", "bin", "obj", "target", ".cache", "__pycache__", ".venv"]);

export const max_walk_entries = 50_000;

const max_age_ms = 15_000;

const cache = new Map<string, Promise<ProjectIndex>>();

const read_dir = async (dir: string): Promise<Dirent[]> => {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    console.warn(`[project] listing ${dir} failed: ${error_text(error)}`);
    return [];
  }
};

const linked_file = async (root: string, absolute: string): Promise<boolean> => {
  try {
    const real = await fs.realpath(absolute);
    return is_inside(root, real) && (await fs.stat(real)).isFile();
  } catch (error) {
    console.warn(`[project] resolving link ${absolute} failed: ${error_text(error)}`);
    return false;
  }
};

const file_size = async (absolute: string): Promise<number> => {
  try {
    return (await fs.stat(absolute)).size;
  } catch (error) {
    console.warn(`[project] stat ${absolute} failed: ${error_text(error)}`);
    return -1;
  }
};

export const walk_project = async (root: string, start: string, signal?: AbortSignal): Promise<ProjectWalk> => {
  const files: IndexEntry[] = [];
  const directories: string[] = [];
  const pending = [start];
  let truncated = false;
  while (pending.length && !truncated) {
    signal?.throwIfAborted();
    const dir = pending.shift() ?? start;
    const candidates: string[] = [];
    for (const item of await read_dir(dir)) {
      const absolute = path.join(dir, item.name);
      const relative = to_posix(path.relative(root, absolute));
      if (is_secret_path(relative)) {
        continue;
      }
      if (item.isDirectory()) {
        if (!ignored_dirs.has(item.name)) {
          directories.push(relative);
          pending.push(absolute);
        }
        continue;
      }
      if (item.isFile() || (item.isSymbolicLink() && (await linked_file(root, absolute)))) {
        candidates.push(absolute);
      }
    }
    const sizes = await Promise.all(candidates.map(file_size));
    candidates.forEach((absolute, index) => {
      const size = sizes[index];
      if (size >= 0) {
        files.push({ path: to_posix(path.relative(root, absolute)), size });
      }
    });
    if (files.length + directories.length > max_walk_entries) {
      truncated = true;
    }
  }
  return { files, directories, truncated };
};

const build_index = async (project_root: string): Promise<ProjectIndex> => {
  const root = await project_real_root(project_root);
  return { root, ...(await walk_project(root, root)), built_at: Date.now() };
};

export const project_index = async (project_root: string): Promise<ProjectIndex> => {
  const key = path_key(path.resolve(project_root));
  const cached = cache.get(key);
  if (cached) {
    const index = await cached;
    if (Date.now() - index.built_at < max_age_ms) {
      return index;
    }
  }
  const building = build_index(project_root);
  cache.set(key, building);
  building.catch((error: unknown) => {
    console.warn(`[project] indexing ${project_root} failed: ${error_text(error)}`);
    if (cache.get(key) === building) {
      cache.delete(key);
    }
  });
  return building;
};

export const invalidate_index = (project_root: string) => {
  cache.delete(path_key(path.resolve(project_root)));
};
