import path from "node:path";
import type { ChatWorktree } from "../../shared/chat.ts";
import { list_chats } from "../chats/store.ts";
import { require_git_tool } from "../git/locate.ts";
import { entry_kind, fsmonitor_off } from "../git/repo.ts";
import { exec_git, git_ok } from "../git/run.ts";
import { follow_project } from "../project/follow.ts";
import { path_key, storage_paths } from "../storage/paths.ts";
import { ledger_add, ledger_drop } from "./ledger.ts";
import { remove_tree, retry_busy } from "./links.ts";

export type WorktreeRelease = { chat_id: string; project_path: string; worktree: ChatWorktree; settled: Promise<unknown> };

const settle_cap_ms = 15_000;

export const id_folder = (worktree_path: string): string => {
  const root = storage_paths().worktrees;
  const holder = path.dirname(path.resolve(worktree_path));
  if (path_key(path.dirname(holder)) !== path_key(root) || !/^[0-9a-f]{8}$/i.test(path.basename(holder))) {
    throw new Error(`refusing to touch ${worktree_path}: it is not a worktree folder of VantheaX under ${root}`);
  }
  return holder;
};

const settle_within = (settled: Promise<unknown>, ms: number): Promise<unknown> => {
  let timer: NodeJS.Timeout | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([Promise.allSettled([settled]), cap]).finally(() => clearTimeout(timer));
};

const prune_worktrees = async (project_path: string) => {
  const main_dir = await follow_project(project_path);
  if ((await entry_kind(main_dir)) !== "dir") {
    console.warn(`[worktrees] the project folder ${main_dir} is missing, git worktree prune was skipped`);
    return;
  }
  const tool = await require_git_tool();
  git_ok(await exec_git(tool, { cwd: main_dir, args: ["worktree", "prune"], flags: fsmonitor_off }), `git worktree prune in ${main_dir}`);
};

export const remove_worktree_folder = async (project_path: string, worktree_path: string): Promise<void> => {
  const holder = id_folder(worktree_path);
  await retry_busy(`removing the worktree folder ${holder}`, () => remove_tree(holder));
  await prune_worktrees(project_path);
};

export const shares_worktree = (worktree_path: string, except: Set<string> = new Set()): boolean =>
  list_chats().some((meta) => !except.has(meta.id) && meta.worktree !== undefined && path_key(meta.worktree.path) === path_key(worktree_path));

export const release_worktree = async (input: WorktreeRelease): Promise<void> => {
  const { worktree } = input;
  if (shares_worktree(worktree.path, new Set([input.chat_id]))) {
    console.info(`[worktrees] the worktree ${worktree.path} of the deleted chat ${input.chat_id} stays, another chat still uses it`);
    return;
  }
  id_folder(worktree.path);
  await ledger_add({ path: worktree.path, project_path: input.project_path, state: "removing", at: new Date().toISOString() });
  await settle_within(input.settled, settle_cap_ms);
  await remove_worktree_folder(input.project_path, worktree.path);
  await ledger_drop(worktree.path);
};
