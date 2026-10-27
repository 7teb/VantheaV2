import { invoke } from "./channel.ts";
import type { FilesScope } from "./files.ts";
import type { FetchError } from "../git-view.ts";
import type { GithubCli } from "../github-view.ts";

export const max_commit_message = 16_000;

export const max_pr_title = 256;

export const max_pr_body = 16_000;

export type WriteGuard = { hooks_off: boolean; commit_block: string[]; push_block: string[] };

export type WriteTextResult = { kind: "text"; text: string } | { kind: "nothing" } | { kind: "failed"; error: string };

export type CommitResult =
  | { kind: "done"; hash: string; left_out: string[] }
  | { kind: "nothing"; left_out: string[] }
  | { kind: "busy" }
  | { kind: "blocked"; reason: "operation" | "conflicts" }
  | { kind: "programs"; keys: string[] }
  | { kind: "identity" }
  | { kind: "hook"; output: string }
  | { kind: "locked" }
  | { kind: "failed"; error: string };

export type PushResult =
  | { kind: "done"; remote: string; branch: string }
  | { kind: "busy" }
  | { kind: "blocked"; reason: "detached" | "unborn" | "no_remote" | "insecure" | "operation" }
  | { kind: "programs"; keys: string[] }
  | { kind: "rejected"; remote: string }
  | { kind: "remote_rejected"; remote: string; detail: string }
  | { kind: "hook"; output: string }
  | { kind: "error"; error: FetchError };

export type PrCli = { kind: "cli"; cli: GithubCli; command: string | null };

export type PrTextResult =
  | { kind: "text"; title: string; body: string; base: string; push_first: number | null }
  | PrCli
  | { kind: "no_commits" }
  | { kind: "failed"; error: string };

export type PrRequest = { title: string; body: string; base: string };

export type CreatePrResult =
  | { kind: "done"; url: string; number: number }
  | { kind: "exists"; url: string | null }
  | { kind: "no_commits" }
  | PrCli
  | { kind: "push"; result: PushResult }
  | { kind: "busy" }
  | { kind: "failed"; error: string };

export const git_actions_channels = {
  "git:write_guard": invoke<[scope: FilesScope], WriteGuard>(),
  "git:write_message": invoke<[scope: FilesScope], WriteTextResult>(),
  "git:commit_changes": invoke<[scope: FilesScope, message: string], CommitResult>(),
  "git:push": invoke<[scope: FilesScope], PushResult>(),
  "github:write_pr": invoke<[scope: FilesScope], PrTextResult>(),
  "github:create_pr": invoke<[scope: FilesScope, request: PrRequest], CreatePrResult>(),
} as const;
