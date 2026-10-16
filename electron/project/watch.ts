import { watch, type WatchEventType } from "node:fs";
import { error_text } from "../storage/coerce.ts";
import { ignored_dirs } from "./index.ts";
import { to_posix } from "./scope.ts";

export type TreeChange = { paths: string[]; overflow: boolean };

export type ChangeCollector = { add: (relative: string | null) => void; close: () => void };

export type TreeWatcher = { close: () => void };

export type WatchTiming = { delay_ms: number; max_wait_ms: number };

export type TreeTap = { path: (event: WatchEventType, relative: string | null) => void; failed: () => void };

export const max_change_paths = 200;

const default_timing: WatchTiming = { delay_ms: 150, max_wait_ms: 1000 };

const change_path = (relative: string) =>
  to_posix(relative)
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");

const ignored_path = (relative: string) => relative.split("/").some((part) => ignored_dirs.has(part));

const not_ignored = (relative: string) => !ignored_path(relative);

export const collect_changes = (flush: (change: TreeChange) => void, timing: WatchTiming = default_timing, keep: (relative: string) => boolean = not_ignored): ChangeCollector => {
  const paths = new Set<string>();
  let overflow = false;
  let timer: NodeJS.Timeout | null = null;
  let first_at = 0;

  const fire = () => {
    timer = null;
    const change = { paths: overflow ? [] : [...paths], overflow };
    paths.clear();
    overflow = false;
    flush(change);
  };

  const schedule = () => {
    const now = Date.now();
    if (timer === null) {
      first_at = now;
    } else {
      clearTimeout(timer);
    }
    timer = setTimeout(fire, Math.max(0, Math.min(timing.delay_ms, first_at + timing.max_wait_ms - now)));
  };

  return {
    add: (relative) => {
      if (relative === null) {
        overflow = true;
        schedule();
        return;
      }
      const normalized = change_path(relative);
      if (!normalized || !keep(normalized)) {
        return;
      }
      if (paths.size >= max_change_paths) {
        overflow = true;
      } else {
        paths.add(normalized);
      }
      schedule();
    },
    close: () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = null;
      paths.clear();
      overflow = false;
    },
  };
};

export const watch_tree = (root: string, on_change: (change: TreeChange) => void, timing: WatchTiming = default_timing, tap?: TreeTap): TreeWatcher => {
  const collector = collect_changes(on_change, timing);
  const watcher = watch(root, { recursive: true }, (event, filename) => {
    collector.add(filename);
    tap?.path(event, filename);
  });
  watcher.on("error", (error) => {
    console.error(`[files] watching ${root} failed: ${error_text(error)}`);
    watcher.close();
    collector.add(null);
    tap?.failed();
  });
  return {
    close: () => {
      watcher.close();
      collector.close();
    },
  };
};
