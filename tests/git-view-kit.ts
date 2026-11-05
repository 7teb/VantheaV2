import type { GitEntry, GitRepoView } from "../shared/git-view.ts";

export const entry = (path: string, status: GitEntry["status"], extra: Partial<GitEntry> = {}): GitEntry => ({
  path,
  orig_path: null,
  status,
  staged: false,
  unstaged: true,
  conflict: null,
  submodule: null,
  nested_repo: false,
  ...extra,
});

export const repo = (extra: Partial<GitRepoView> = {}, branch: Partial<GitRepoView["branch"]> = {}): GitRepoView => ({
  kind: "repo",
  repo: { root: "D:/project", prefix: "", worktree_of: null, superproject: null, shallow: false },
  branch: { name: "main", detached_at: null, unborn: false, upstream: "origin/main", upstream_gone: false, ahead: 4, behind: 0, stash: 0, ...branch },
  head: "4276a37f0c1d2e3b4a5968778695a4b3c2d1e0f9",
  entries: [],
  operation: null,
  remotes: [{ name: "origin", url: "https://github.com/7teb/VantheaX.git", host: "github.com", host_kind: "github", slug: "7teb/VantheaX" }],
  primary_remote: "origin",
  fetch: { at: null, running: false, error: null, blocked: null, queued: false },
  fingerprint: "f1",
  refreshing: false,
  watch_failed: false,
  ...extra,
});
