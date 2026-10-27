import type { GitFileDiff } from "../../../../../shared/git-view.ts";
import type { DiffNote, DiffSummary, NoGitReason } from "../../../../../shared/turn-diff.ts";
import type { MessageKey, MessageVars, Translate } from "../../../../i18n/translate.ts";

export type ReadySummary = Extract<DiffSummary, { kind: "ready" }>;

type Clock = (iso: string) => string;

const reason_keys: Record<NoGitReason, MessageKey> = {
  not_repo: "turn_diff.reason_not_repo",
  git_missing: "turn_diff.reason_git_missing",
  git_too_old: "turn_diff.reason_git_too_old",
  ownership: "turn_diff.reason_ownership",
  ignored_folder: "turn_diff.reason_ignored_folder",
  snapshot_failed: "turn_diff.reason_snapshot_failed",
};

export const file_note_keys: Record<Exclude<GitFileDiff["kind"], "text">, MessageKey> = {
  binary: "turn_diff.binary",
  object_missing: "turn_diff.object_missing",
  eol_only: "git.viewer_eol",
  unchanged: "git.viewer_unchanged",
  conflict: "git.conflict",
};

const reason_vars = (reason: NoGitReason, detail: string): MessageVars => {
  if (reason === "git_too_old") return { version: detail };
  if (reason === "ignored_folder") return { repo: detail };
  if (reason === "snapshot_failed") return { error: detail };
  return {};
};

const unreadable_text = (t: Translate, summary: ReadySummary, paths: string[]): string => {
  const listed = paths.join(", ");
  const git = summary.source === "git";
  if (paths.length === 1) {
    return t(git ? "turn_diff.unreadable_one" : "turn_diff.unread_one", { paths: listed });
  }
  return t(git ? "turn_diff.unreadable" : "turn_diff.unread", { n: paths.length, paths: listed });
};

const end_missing_text = (t: Translate, summary: ReadySummary, note: Extract<DiffNote, { kind: "end_missing" }>, clock: Clock): string => {
  const next = summary.end.kind === "next_turn";
  if (note.reason === "app_closed") {
    return next ? t("turn_diff.closed_next") : t("turn_diff.closed_live", { time: clock(summary.end.at) });
  }
  return next ? t("turn_diff.end_failed_next", { error: note.detail }) : t("turn_diff.end_failed_live", { error: note.detail, time: clock(summary.end.at) });
};

const note_text = (t: Translate, summary: ReadySummary, note: DiffNote, clock: Clock): string => {
  switch (note.kind) {
    case "no_git":
      return t("turn_diff.no_git", { reason: t(reason_keys[note.reason], reason_vars(note.reason, note.detail)) });
    case "running":
      return t("turn_diff.running", { time: clock(summary.end.at) });
    case "end_missing":
      return end_missing_text(t, summary, note, clock);
    case "unreadable":
      return unreadable_text(t, summary, note.paths);
    case "renames_skipped":
      return t("turn_diff.renames_skipped");
    case "earlier_turns_missing":
      return t("turn_diff.earlier_missing", { time: clock(note.before) });
  }
};

export const note_texts = (t: Translate, summary: ReadySummary, clock: Clock): string[] => {
  const texts = summary.notes.map((note) => note_text(t, summary, note, clock));
  const explained = summary.notes.some((note) => note.kind === "running" || note.kind === "end_missing");
  if (summary.end.kind === "live" && !explained) {
    texts.push(t("turn_diff.live", { time: clock(summary.end.at) }));
  }
  return texts;
};
