import type { GitEntry, GitFileStatus } from "../git-view.ts";

export type GitDecoration = { status: GitFileStatus; entry: GitEntry | null; rollup: boolean };

export type GitDecorations = {
  exact: Map<string, GitEntry>;
  folders: Map<string, GitFileStatus>;
  untracked: string[];
  ignored: string[];
};

const rank: Record<GitFileStatus, number> = {
  conflicted: 8,
  deleted: 7,
  modified: 6,
  type_changed: 5,
  renamed: 4,
  copied: 3,
  added: 2,
  untracked: 1,
  ignored: 0,
};

export const decoration_key = (path: string): string => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

const parent_of = (key: string): string => {
  const at = key.lastIndexOf("/");
  return at < 0 ? "" : key.slice(0, at);
};

const mark_folder = (folders: Map<string, GitFileStatus>, key: string, status: GitFileStatus) => {
  const current = folders.get(key);
  if (current === undefined || rank[status] > rank[current]) {
    folders.set(key, status);
  }
};

export const git_decorations = (entries: GitEntry[]): GitDecorations => {
  const decorations: GitDecorations = { exact: new Map(), folders: new Map(), untracked: [], ignored: [] };
  for (const entry of entries) {
    const key = decoration_key(entry.path);
    decorations.exact.set(key, entry);
    if (entry.path.endsWith("/") && entry.status === "untracked" && !entry.nested_repo) decorations.untracked.push(`${key}/`);
    if (entry.path.endsWith("/") && entry.status === "ignored") decorations.ignored.push(`${key}/`);
    if (entry.status === "ignored") continue;
    if (entry.status === "deleted") {
      const parent = parent_of(key);
      if (parent) mark_folder(decorations.folders, parent, "deleted");
      continue;
    }
    for (let parent = parent_of(key); parent; parent = parent_of(parent)) {
      mark_folder(decorations.folders, parent, entry.status);
    }
  }
  return decorations;
};

const longest_prefix = (prefixes: string[], probe: string): number =>
  prefixes.reduce((best, prefix) => (probe.startsWith(prefix) && prefix.length > best ? prefix.length : best), 0);

export const decoration_of = (decorations: GitDecorations, path: string, dir: boolean): GitDecoration | null => {
  const key = decoration_key(path);
  const entry = decorations.exact.get(key);
  if (entry) {
    return { status: entry.status, entry, rollup: false };
  }
  const probe = `${key}/`;
  const untracked = longest_prefix(decorations.untracked, probe);
  const ignored = longest_prefix(decorations.ignored, probe);
  if (untracked > 0 || ignored > 0) {
    return { status: ignored > untracked ? "ignored" : "untracked", entry: null, rollup: false };
  }
  const folder = dir ? decorations.folders.get(key) : undefined;
  return folder === undefined ? null : { status: folder, entry: null, rollup: true };
};
