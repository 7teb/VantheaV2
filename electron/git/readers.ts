import type { GitOperation } from "../../shared/git-view.ts";
import { read_guard, type GitGuard } from "./guard.ts";
import { recheck_git_tool, type GitFound } from "./locate.ts";
import { read_operation } from "./operation.ts";
import { read_refs, type RefsRead } from "./refs.ts";
import { read_remotes, type RemotesRead } from "./remotes.ts";
import { detect_repo, entry_kind, git_location, type GitLocation, type RepoDetect, type RepoPaths } from "./repo.ts";
import type { GitConfigPair, GitTool, GitVersion } from "./run.ts";
import { run_status } from "./status.ts";
import { watch_git_dirs, type GitDirWatch, type GitWatchDir, type GitWatchKind } from "./watch.ts";

export type GitReaders = {
  tool: (needed: GitVersion, registry: boolean) => Promise<GitFound>;
  location: (root: string) => Promise<GitLocation | null>;
  detect: (tool: GitTool, root: string, signal: AbortSignal) => Promise<RepoDetect>;
  guard: (tool: GitTool, paths: RepoPaths, previous: GitGuard | null, signal: AbortSignal) => Promise<GitGuard>;
  status: (tool: GitTool, root: string, config: GitConfigPair[], signal: AbortSignal) => Promise<Buffer>;
  operation: (git_dir: string) => Promise<GitOperation | null>;
  refs: (tool: GitTool, root: string, git_dir: string, config: GitConfigPair[], signal: AbortSignal) => Promise<RefsRead>;
  remotes: (tool: GitTool, root: string, config: GitConfigPair[], signal: AbortSignal) => Promise<RemotesRead>;
  watch: (dirs: GitWatchDir[], on_kinds: (kinds: GitWatchKind[]) => void, on_error: () => void) => GitDirWatch;
  entry_kind: (file: string) => Promise<"file" | "dir" | null>;
};

export const default_readers: GitReaders = {
  tool: recheck_git_tool,
  location: git_location,
  detect: detect_repo,
  guard: read_guard,
  status: run_status,
  operation: read_operation,
  refs: read_refs,
  remotes: read_remotes,
  watch: watch_git_dirs,
  entry_kind,
};
