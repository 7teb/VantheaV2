import type { DiffLine } from "./tool-view.ts";

export type GitFileStatus = "modified" | "added" | "deleted" | "renamed" | "copied" | "type_changed" | "untracked" | "ignored" | "conflicted";

export type GitConflict = "DD" | "AU" | "UD" | "UA" | "DU" | "AA" | "UU";

export type GitSubmoduleState = { commit: boolean; tracked: boolean; untracked: boolean };

export type GitEntry = {
  path: string;
  orig_path: string | null;
  status: GitFileStatus;
  staged: boolean;
  unstaged: boolean;
  conflict: GitConflict | null;
  submodule: GitSubmoduleState | null;
  nested_repo: boolean;
};

export type GitBranch = {
  name: string | null;
  detached_at: string | null;
  unborn: boolean;
  upstream: string | null;
  upstream_gone: boolean;
  ahead: number | null;
  behind: number | null;
  stash: number;
};

export type GitOperation = {
  kind: "merge" | "rebase" | "am" | "am_or_rebase" | "cherry_pick" | "revert" | "bisect";
  step: number | null;
  total: number | null;
  branch: string | null;
};

export type GitHostKind = "github" | "ghe_com" | "ghes" | "other" | "local" | "helper";

export type GitRemote = { name: string; url: string; host: string | null; host_kind: GitHostKind; slug: string | null };

export type FetchError = {
  kind: "auth_required" | "ssh_key_rejected" | "ssh_host_unknown" | "remote_not_found" | "offline" | "error";
  remote: string;
  host: string | null;
  detail: string;
  command: string | null;
};

export type FetchBlock =
  | { kind: "agent_running" }
  | { kind: "insecure_transport"; scheme: string }
  | { kind: "repo_config"; keys: string[] }
  | { kind: "local_refspec"; key: string };

export type FetchState = {
  at: string | null;
  running: boolean;
  error: FetchError | null;
  blocked: FetchBlock | null;
  queued: boolean;
};

export type GitRepoInfo = { root: string; prefix: string; worktree_of: string | null; superproject: string | null; shallow: boolean };

export type GitRepoView = {
  kind: "repo";
  repo: GitRepoInfo;
  branch: GitBranch;
  head: string | null;
  entries: GitEntry[];
  operation: GitOperation | null;
  remotes: GitRemote[];
  primary_remote: string | null;
  fetch: FetchState;
  fingerprint: string;
  refreshing: boolean;
  watch_failed: boolean;
};

export type GitView =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "git_missing" }
  | { kind: "git_too_old"; version: string; reason: "minimum" | "partial_clone" }
  | { kind: "blocked_ownership"; path: string }
  | { kind: "outside_tracked"; repo_root: string }
  | { kind: "error"; message: string; broken_gitfile: boolean }
  | GitRepoView;

export type GitFileDiff =
  | { kind: "text"; lines: DiffLine[] }
  | { kind: "binary" }
  | { kind: "eol_only" }
  | { kind: "conflict" }
  | { kind: "object_missing" }
  | { kind: "unchanged" };

export type LineCount = { path: string; added: number | null; removed: number | null };

export type GraphEdge = { from: number; to: number; color: number };

export type RefLabel = { name: string; kind: "head" | "branch" | "remote" | "tag"; worktree: string | null };

export type GraphRow = {
  hash: string;
  parents: string[];
  author: string;
  time: number | null;
  subject: string;
  col: number;
  color: number;
  up: GraphEdge[];
  down: GraphEdge[];
  width: number;
  labels: RefLabel[];
};

export type HistoryRequest = { fingerprint: string | null; offset: number };

export type HistoryPage = { fingerprint: string; start: number; rows: GraphRow[]; done: boolean; shallow_end: boolean };

export type CommitFile = {
  status: Extract<GitFileStatus, "modified" | "added" | "deleted" | "renamed" | "type_changed">;
  path: string;
  orig_path: string | null;
  added: number | null;
  removed: number | null;
};

export type CommitDetail = { hash: string; parents: string[]; author: string; email: string; time: number | null; message: string; files: CommitFile[]; counted: boolean };
