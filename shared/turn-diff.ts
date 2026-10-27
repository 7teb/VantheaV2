export type TurnSpan = { from_id: string; to_id: string };

export type DiffScope = ({ kind: "turn" } & TurnSpan) | { kind: "chat" };

export type DiffSource = "git" | "recorded";

export type DiffStatus = "added" | "modified" | "deleted" | "renamed" | "type_changed" | "submodule";

export type DiffEntry = {
  path: string;
  orig_path: string | null;
  status: DiffStatus;
  added: number | null;
  removed: number | null;
  binary: boolean;
  commits: { from: string | null; to: string | null } | null;
};

export type NoGitReason = "not_repo" | "git_missing" | "git_too_old" | "ownership" | "ignored_folder" | "snapshot_failed";

export type DiffEnd = { kind: "snapshot" | "next_turn" | "live"; at: string };

export type DiffNote =
  | { kind: "no_git"; reason: NoGitReason; detail: string }
  | { kind: "running" }
  | { kind: "end_missing"; reason: "app_closed" | "snapshot_failed"; detail: string }
  | { kind: "unreadable"; paths: string[] }
  | { kind: "renames_skipped" }
  | { kind: "earlier_turns_missing"; before: string };

export type DiffSummary =
  | { kind: "ready"; source: DiffSource; base_at: string; end: DiffEnd; entries: DiffEntry[]; notes: DiffNote[] }
  | { kind: "none" }
  | { kind: "failed"; error: string };

export type TurnDiffChange = { chat_id: string };

export const no_git_reasons: readonly NoGitReason[] = ["not_repo", "git_missing", "git_too_old", "ownership", "ignored_folder", "snapshot_failed"];

export const diff_statuses: readonly DiffStatus[] = ["added", "modified", "deleted", "renamed", "type_changed", "submodule"];

export const scope_key = (scope: DiffScope): string => (scope.kind === "chat" ? "chat" : `${scope.from_id}:${scope.to_id}`);
