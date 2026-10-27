import path from "node:path";
import type { ChatWorktree } from "../../shared/chat.ts";
import type { WorktreeHead } from "../../shared/ipc/worktrees.ts";
import { chat_meta } from "../chats/store.ts";
import { worktree_dir } from "../chats/workspace.ts";
import { entry_kind, gitfile_target, read_optional } from "../git/repo.ts";

export const worktree_head = async (worktree: ChatWorktree): Promise<WorktreeHead> => {
  if ((await entry_kind(worktree_dir(worktree))) !== "dir") {
    return { branch: null, detached_at: null, missing: true };
  }
  const git_dir = await gitfile_target(path.join(worktree.path, ".git"));
  const head = git_dir ? await read_optional(path.join(git_dir, "HEAD")) : null;
  const branch = head ? (/^ref:\s*refs\/heads\/(.+)$/m.exec(head)?.[1]?.trim() ?? null) : null;
  const detached_at = head ? (/^([0-9a-f]{40}|[0-9a-f]{64})\s*$/.exec(head)?.[1] ?? null) : null;
  return { branch, detached_at, missing: false };
};

export const chat_worktree_head = async (chat_id: string): Promise<WorktreeHead> => {
  const worktree = chat_meta(chat_id)?.worktree;
  if (!worktree) {
    throw new Error(`chat ${chat_id} has no worktree`);
  }
  return worktree_head(worktree);
};
