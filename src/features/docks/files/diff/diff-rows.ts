import type { DiffEntry, DiffStatus } from "../../../../../shared/turn-diff.ts";
import { base_name, parent_dir } from "../../../../state/files-tree.ts";

export const status_letters: Record<DiffStatus, string> = { added: "A", modified: "M", deleted: "D", renamed: "R", type_changed: "T", submodule: "S" };

export const openable = (entry: DiffEntry): boolean => entry.status !== "submodule";

export const entry_place = (entry: DiffEntry): string => (entry.orig_path === null ? parent_dir(entry.path) : `← ${base_name(entry.orig_path)}`);

const short_commit = (commit: string | null, none: string): string => (commit === null ? none : commit.slice(0, 7));

export const submodule_text = (entry: DiffEntry, none: string): string => `${short_commit(entry.commits?.from ?? null, none)} → ${short_commit(entry.commits?.to ?? null, none)}`;

export const totals = (entries: readonly DiffEntry[]): { added: number; removed: number } => {
  let added = 0;
  let removed = 0;
  for (const entry of entries) {
    added += entry.added ?? 0;
    removed += entry.removed ?? 0;
  }
  return { added, removed };
};

const same_day = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();

export const clock_label = (language: string, iso: string, now: Date): string => {
  const date = new Date(iso);
  const options: Intl.DateTimeFormatOptions = same_day(date, now)
    ? { hour: "numeric", minute: "2-digit" }
    : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
  return new Intl.DateTimeFormat(language, options).format(date);
};

export const short_clock_label = (language: string, iso: string, now: Date): string => {
  const date = new Date(iso);
  const options: Intl.DateTimeFormatOptions = same_day(date, now) ? { hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short" };
  return new Intl.DateTimeFormat(language, options).format(date);
};
