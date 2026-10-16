import type { FetchState, GitBranch, GitOperation, GitRemote, GitView } from "../../shared/git-view.ts";
import type { FilesRoot } from "../../shared/ipc/files.ts";
import type { StatusBranch } from "../../shared/git/status-parse.ts";
import { idle_fetch } from "./fetch.ts";
import { refs_fingerprint, type RefsRead } from "./refs.ts";
import { last_fetch_at, primary_remote, type RemotesRead } from "./remotes.ts";
import { repo_info, type RepoDetect, type RepoPaths } from "./repo.ts";
import type { ProjectStatus } from "./status.ts";

export type ViewParts = {
  root_kind: FilesRoot["kind"];
  special: GitView | null;
  failures: Map<string, string>;
  paths: RepoPaths | null;
  status: ProjectStatus | null;
  operation: GitOperation | null;
  refs: RefsRead | null;
  remotes: RemotesRead | null;
  refreshing: boolean;
  watch_failed: boolean;
};

const branch_of = (status: StatusBranch): GitBranch => ({
  name: status.head,
  detached_at: status.head === null ? status.oid : null,
  unborn: status.oid === null,
  upstream: status.upstream,
  upstream_gone: status.upstream !== null && status.ahead === null,
  ahead: status.ahead,
  behind: status.behind,
  stash: status.stash,
});

export const special_of = (detected: Exclude<RepoDetect, { kind: "repo" }>): GitView => {
  if (detected.kind === "ownership") return { kind: "blocked_ownership", path: detected.path };
  if (detected.kind === "error") return { kind: "error", message: detected.message, broken_gitfile: detected.broken_gitfile };
  return { kind: "none" };
};

export type FetchOf = (remote: GitRemote, fetch_head_at: string | null) => FetchState;

export const assemble_view = (parts: ViewParts, fetch_of: FetchOf): GitView => {
  if (parts.special) {
    return parts.special;
  }
  const failure = [...parts.failures.values()][0];
  if (failure !== undefined) {
    return { kind: "error", message: failure, broken_gitfile: false };
  }
  const { paths, status, refs, remotes } = parts;
  if (!paths || !status || !refs || !remotes) {
    return { kind: "loading" };
  }
  if (status.outside) {
    return parts.root_kind === "project" ? { kind: "outside_tracked", repo_root: paths.top } : { kind: "none" };
  }
  const primary = primary_remote(remotes.remotes, status.branch.upstream);
  const remote = remotes.remotes.find((entry) => entry.name === primary);
  const fetch = remote ? fetch_of(remote, last_fetch_at(refs.fetch_head, remote.url)) : idle_fetch;
  return {
    kind: "repo",
    repo: repo_info(paths),
    branch: branch_of(status.branch),
    head: status.branch.oid,
    entries: status.entries,
    operation: parts.operation,
    remotes: remotes.remotes,
    primary_remote: primary,
    fetch,
    fingerprint: refs_fingerprint(refs.raw, status.branch.oid),
    refreshing: parts.refreshing,
    watch_failed: parts.watch_failed,
  };
};
