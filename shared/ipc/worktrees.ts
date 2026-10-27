import type { ChatMeta } from "../chat.ts";
import { invoke } from "./channel.ts";

export type WorktreeEligibility =
  | { kind: "ready"; branch: string | null; submodules: boolean }
  | { kind: "not_repo" }
  | { kind: "no_commits" }
  | { kind: "untracked_folder" }
  | { kind: "git_missing" }
  | { kind: "programs"; keys: string[] }
  | { kind: "failed"; error: string };

export type WorktreeHead = { branch: string | null; detached_at: string | null; missing: boolean };

export type WorktreeWork = { chat_id: string; title: string; branch: string; changed: number; unpushed: number; missing: boolean; shared: boolean };

export type WorktreeTarget = { kind: "chats"; chat_ids: string[] } | { kind: "project"; project_path: string } | { kind: "projects" } | { kind: "all" };

export const worktrees_channels = {
  "worktrees:eligibility": invoke<[project_path: string], WorktreeEligibility>(),
  "worktrees:create_chat": invoke<[project_path: string, seed_text: string], ChatMeta>(),
  "worktrees:work": invoke<[target: WorktreeTarget], WorktreeWork[]>(),
  "worktrees:head": invoke<[chat_id: string], WorktreeHead>(),
  "worktrees:restore": invoke<[chat_id: string], ChatMeta>(),
} as const;
