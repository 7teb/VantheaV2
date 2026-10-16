import { watch, type FSWatcher } from "node:fs";
import { collect_changes, type ChangeCollector, type TreeChange, type WatchTiming } from "../project/watch.ts";
import { error_text } from "../storage/coerce.ts";

export type GitWatchKind = "detect" | "status" | "refs" | "remotes";

export type GitWatchDir = { dir: string; own_worktree: string | null };

export type GitDirWatch = { close: () => void };

const operation_files = new Set(["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD", "BISECT_LOG"]);

const operation_dirs = new Set(["rebase-merge", "rebase-apply", "sequencer"]);

const worktree_files = new Set(["HEAD", "ORIG_HEAD", "index", "FETCH_HEAD", "AUTO_MERGE", "config.worktree", "logs", ...operation_files, ...operation_dirs]);

const noise_dirs = new Set(["objects", "logs", "hooks"]);

const status_refs: GitWatchKind[] = ["status", "refs"];

const config_kinds: GitWatchKind[] = ["status", "remotes"];

const module_kinds = (parts: string[]): GitWatchKind[] => {
  const last = parts.at(-1) ?? "";
  if (parts.some((part) => noise_dirs.has(part))) return [];
  return last === "config" || last === "HEAD" || last === "index" || last === "packed-refs" || parts.includes("refs") ? ["status"] : [];
};

const repo_kinds = (parts: string[]): GitWatchKind[] => {
  const [first = "", second] = parts;
  if (noise_dirs.has(first)) return [];
  if (first === "modules") return module_kinds(parts);
  if (first === "index") return ["status"];
  if (first === "HEAD" || first === "FETCH_HEAD" || first === "packed-refs" || first === "refs" || first === "reftable") return status_refs;
  if (parts.length === 1 && (first === "config" || first === "config.worktree")) return config_kinds;
  if (first === "info" && second === "exclude") return ["status"];
  if (operation_files.has(first) || operation_dirs.has(first)) return ["status"];
  return [];
};

export const classify_git_path = (relative: string, own_worktree: string | null): GitWatchKind[] => {
  const parts = relative.replace(/\\/g, "/").split("/").filter((part) => part !== "" && part !== ".");
  const last = parts.at(-1) ?? "";
  if (parts.length === 0 || last.endsWith(".lock") || last === "COMMIT_EDITMSG" || last === "description") {
    return [];
  }
  if (parts[0] === "worktrees") {
    return own_worktree !== null && parts[1] === own_worktree ? repo_kinds(parts.slice(2)) : [];
  }
  if (own_worktree !== null && worktree_files.has(parts[0] ?? "")) {
    return [];
  }
  return repo_kinds(parts);
};

export const tree_kinds = (change: TreeChange): GitWatchKind[] => {
  if (change.overflow || change.paths.includes(".git")) return ["detect"];
  return change.paths.length > 0 ? ["status"] : [];
};

export const tree_collector = (on_kinds: (kinds: GitWatchKind[]) => void, timing?: WatchTiming): ChangeCollector =>
  collect_changes((change) => on_kinds(tree_kinds(change)), timing, (relative) => !relative.startsWith(".git/"));

export const watch_git_dirs = (dirs: GitWatchDir[], on_kinds: (kinds: GitWatchKind[]) => void, on_error: () => void, timing?: WatchTiming): GitDirWatch => {
  const watchers: FSWatcher[] = [];
  const collectors: ChangeCollector[] = [];
  let closed = false;
  const close = () => {
    closed = true;
    for (const watcher of watchers) watcher.close();
    for (const collector of collectors) collector.close();
  };
  for (const { dir, own_worktree } of dirs) {
    const collector = collect_changes(
      (change) => on_kinds(change.overflow ? ["status", "refs", "remotes"] : [...new Set(change.paths.flatMap((relative) => classify_git_path(relative, own_worktree)))]),
      timing,
      (relative) => classify_git_path(relative, own_worktree).length > 0,
    );
    collectors.push(collector);
    const failed = (error: unknown) => {
      console.error(`[git] watching ${dir} failed: ${error_text(error)}`);
      if (!closed) {
        close();
        on_error();
      }
    };
    try {
      const watcher = watch(dir, { recursive: true }, (_event, filename) => collector.add(filename));
      watcher.on("error", failed);
      watchers.push(watcher);
    } catch (error) {
      failed(error);
      break;
    }
  }
  return { close };
};
