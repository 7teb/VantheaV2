import type { DirEntry } from "../../shared/ipc/files.ts";

export type DirLoad = { status: "loading" | "ready" | "failed"; entries: DirEntry[]; more: number };

export type TreeRow =
  | { kind: "entry"; entry: DirEntry; depth: number; open: boolean }
  | { kind: "more"; path: string; count: number; depth: number }
  | { kind: "loading"; path: string; depth: number }
  | { kind: "failed"; path: string; depth: number };

export type ChangeTargets = { dirs: string[]; files: string[] };

export const base_name = (file: string) => file.slice(file.lastIndexOf("/") + 1);

export const parent_dir = (file: string) => {
  const cut = file.lastIndexOf("/");
  return cut < 0 ? "" : file.slice(0, cut);
};

const within = (target: string, changed: string) => target === changed || target.startsWith(`${changed}/`);

export const tree_rows = (dirs: Record<string, DirLoad>, expanded: string[]): TreeRow[] => {
  const open_dirs = new Set(expanded);
  const rows: TreeRow[] = [];
  const walk = (dir: string, depth: number) => {
    const load = dirs[dir];
    if (!load || load.status === "loading") {
      rows.push({ kind: "loading", path: dir, depth });
      return;
    }
    if (load.status === "failed") {
      rows.push({ kind: "failed", path: dir, depth });
      return;
    }
    for (const entry of load.entries) {
      const open = entry.kind === "dir" && open_dirs.has(entry.path);
      rows.push({ kind: "entry", entry, depth, open });
      if (open) {
        walk(entry.path, depth + 1);
      }
    }
    if (load.more > 0) {
      rows.push({ kind: "more", path: dir, count: load.more, depth });
    }
  };
  walk("", 0);
  return rows;
};

export const change_targets = (change: { paths: string[]; overflow: boolean }, dirs: string[], files: string[]): ChangeTargets => {
  if (change.overflow) {
    return { dirs, files };
  }
  return {
    dirs: dirs.filter((dir) => change.paths.some((changed) => parent_dir(changed) === dir || within(dir, changed))),
    files: files.filter((file) => change.paths.some((changed) => within(file, changed))),
  };
};

export const after_close = (paths: string[], closing: string, active: string | null): string | null => {
  if (active !== closing) {
    return active;
  }
  const index = paths.indexOf(closing);
  const rest = paths.filter((entry) => entry !== closing);
  return rest[Math.min(index, rest.length - 1)] ?? null;
};

export const line_count = (text: string) => (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n").length;
