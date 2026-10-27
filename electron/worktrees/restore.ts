import fs from "node:fs/promises";
import type { ChatMeta } from "../../shared/chat.ts";
import { chat_meta } from "../chats/store.ts";
import { worktree_dir } from "../chats/workspace.ts";
import { require_git_tool } from "../git/locate.ts";
import { detect_repo, entry_kind, fsmonitor_off } from "../git/repo.ts";
import { exec_git, git_ok } from "../git/run.ts";
import { read_owned_filters } from "../git/write-guard.ts";
import { known_project_dir } from "../project/follow.ts";
import { worktree_step } from "./create.ts";
import { programs_refusal } from "./eligibility.ts";
import { copy_included } from "./include.ts";
import { link_node_modules } from "./links.ts";
import { id_folder } from "./remove.ts";

export const restore_worktree = async (chat_id: string): Promise<ChatMeta> => {
  const meta = chat_meta(chat_id);
  if (!meta?.worktree) {
    throw new Error(`chat ${chat_id} has no worktree`);
  }
  const { worktree } = meta;
  const dir = worktree_dir(worktree);
  if ((await entry_kind(dir)) === "dir") {
    return meta;
  }
  const holder = id_folder(worktree.path);
  const main_dir = await known_project_dir(meta.project_path);
  const tool = await require_git_tool();
  const run = async (args: string[]) => exec_git(tool, { cwd: main_dir, args, flags: fsmonitor_off });
  git_ok(await run(["worktree", "prune"]), `git worktree prune in ${main_dir}`);
  if ((await run(["rev-parse", "--verify", "--quiet", `refs/heads/${worktree.branch}`])).code !== 0) {
    throw new Error(`The branch ${worktree.branch} of this worktree no longer exists, so the worktree cannot be restored`);
  }
  const detected = await detect_repo(tool, main_dir);
  if (detected.kind !== "repo") {
    throw new Error(`the project folder ${main_dir} is no longer a Git repository`);
  }
  const filters = await read_owned_filters(tool, detected.paths.top);
  if (filters.length > 0) {
    throw new Error(programs_refusal(filters));
  }
  await worktree_step("add worktree", async () => {
    await fs.mkdir(holder, { recursive: true });
    git_ok(await run(["worktree", "add", worktree.path, worktree.branch]), `git worktree add ${worktree.path} ${worktree.branch}`);
  });
  await worktree_step("link node_modules", () => link_node_modules(main_dir, dir));
  await worktree_step("copy .worktreeinclude files", () => copy_included(tool, detected.paths.top, worktree.path));
  console.info(`[worktrees] restored the worktree ${worktree.path} of chat ${chat_id} on ${worktree.branch}`);
  return chat_meta(chat_id) ?? meta;
};
