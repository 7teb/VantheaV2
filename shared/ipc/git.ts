import { emit, invoke } from "./channel.ts";
import type { FilesScope } from "./files.ts";
import type { CommitDetail, GitFileDiff, GitView, HistoryPage, HistoryRequest, LineCount } from "../git-view.ts";

export type GitChange = { root: string; view: GitView };

export const git_channels = {
  "git:refresh": invoke<[scope: FilesScope], void>(),
  "git:diff": invoke<[scope: FilesScope, path: string], GitFileDiff>(),
  "git:line_counts": invoke<[scope: FilesScope], LineCount[]>(),
  "git:history": invoke<[scope: FilesScope, request: HistoryRequest], HistoryPage>(),
  "git:history_close": invoke<[], void>(),
  "git:commit": invoke<[scope: FilesScope, hash: string], CommitDetail>(),
  "git:commit_diff": invoke<[scope: FilesScope, hash: string, path: string], GitFileDiff>(),
  "git:changed": emit<GitChange>(),
} as const;
