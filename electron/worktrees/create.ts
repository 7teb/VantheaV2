import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ChatMeta, ChatWorktree } from "../../shared/chat.ts";
import { create_chat } from "../chats/store.ts";
import { worktree_dir } from "../chats/workspace.ts";
import { require_git_tool } from "../git/locate.ts";
import { entry_kind, fsmonitor_off } from "../git/repo.ts";
import { exec_git, git_ok, type GitTool } from "../git/run.ts";
import { known_project_dir } from "../project/follow.ts";
import { error_text } from "../storage/coerce.ts";
import { storage_paths } from "../storage/paths.ts";
import { inspect_repo, refusal_text } from "./eligibility.ts";
import { copy_included } from "./include.ts";
import { ledger_add, ledger_drop } from "./ledger.ts";
import { link_node_modules } from "./links.ts";
import { branch_prefix, branch_slug, free_branch, worktree_leaf } from "./naming.ts";
import { remove_worktree_folder } from "./remove.ts";

export const worktree_step = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    throw new Error(`worktree step "${name}" failed: ${error_text(error)}`, { cause: error });
  }
};

export const pick_folder = async (root: string, leaf: string, taken: (dir: string) => Promise<boolean>, new_id: () => string): Promise<string> => {
  for (;;) {
    const holder = path.join(root, new_id());
    if (!(await taken(holder))) {
      return path.join(holder, leaf);
    }
  }
};

const folder_taken = async (dir: string): Promise<boolean> => (await entry_kind(dir)) !== null;

const new_folder_id = () => randomBytes(4).toString("hex");

const run_git = async (tool: GitTool, cwd: string, args: string[]): Promise<string> =>
  git_ok(await exec_git(tool, { cwd, args, flags: fsmonitor_off }), `git ${args.slice(0, 2).join(" ")} in ${cwd}`).toString("utf8");

const local_branches = async (tool: GitTool, top: string): Promise<string[]> =>
  (await run_git(tool, top, ["for-each-ref", "--format=%(refname:strip=2)", "refs/heads/"]))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const pick_branch = async (tool: GitTool, top: string, seed_text: string, folder_id: string): Promise<string> => {
  const name = free_branch(`${branch_prefix}${branch_slug(seed_text, folder_id)}`, await local_branches(tool, top));
  await run_git(tool, top, ["check-ref-format", "--branch", name]);
  return name;
};

const drop_new_branch = async (tool: GitTool, cwd: string, worktree: ChatWorktree) => {
  const ref = `refs/heads/${worktree.branch}`;
  const output = await exec_git(tool, { cwd, args: ["rev-parse", "--verify", "--quiet", ref], flags: fsmonitor_off });
  if (output.code === 0 && output.stdout.toString("utf8").trim() === worktree.base) {
    await run_git(tool, cwd, ["update-ref", "-d", ref, worktree.base]);
  }
};

const undo_worktree = async (project_path: string, project_dir: string, worktree: ChatWorktree) => {
  try {
    await remove_worktree_folder(project_path, worktree.path);
    await drop_new_branch(await require_git_tool(), project_dir, worktree);
    await ledger_drop(worktree.path);
  } catch (error) {
    console.error(`[worktrees] cleaning up the unfinished worktree ${worktree.path} of ${project_dir} failed, it is retried at the next start:`, error);
  }
};

export const create_worktree = async (project_path: string, project_dir: string, seed_text: string): Promise<ChatWorktree> => {
  const repo = await worktree_step("check repository", () => inspect_repo(project_dir));
  if (repo.kind !== "ready") {
    throw new Error(`worktree step "check repository" failed: ${refusal_text(repo)}`);
  }
  const { tool, paths } = repo;
  const folder = await worktree_step("pick folder", () => pick_folder(storage_paths().worktrees, worktree_leaf(paths.top), folder_taken, new_folder_id));
  const branch = await worktree_step("pick branch", () => pick_branch(tool, paths.top, seed_text, path.basename(path.dirname(folder))));
  const worktree: ChatWorktree = { path: folder, prefix: repo.prefix, branch, base: repo.base, created_at: new Date().toISOString() };
  await worktree_step("record in the ledger", () => ledger_add({ path: folder, project_path, state: "creating", at: worktree.created_at }));
  try {
    await worktree_step("add worktree", async () => {
      await fs.mkdir(path.dirname(folder), { recursive: true });
      await run_git(tool, paths.top, ["worktree", "add", "-b", branch, folder, repo.base]);
    });
    await worktree_step("link node_modules", () => link_node_modules(project_dir, worktree_dir(worktree)));
    await worktree_step("copy .worktreeinclude files", () => copy_included(tool, paths.top, folder));
  } catch (error) {
    await undo_worktree(project_path, project_dir, worktree);
    throw error;
  }
  return worktree;
};

export const create_worktree_chat = async (project_path: string, seed_text: string): Promise<ChatMeta> => {
  const project_dir = await known_project_dir(project_path);
  const worktree = await create_worktree(project_path, project_dir, seed_text);
  let meta: ChatMeta;
  try {
    meta = await worktree_step("create chat", () => create_chat(project_path, worktree));
  } catch (error) {
    await undo_worktree(project_path, project_dir, worktree);
    throw error;
  }
  await ledger_drop(worktree.path).catch((error: unknown) =>
    console.error(`[worktrees] dropping the finished worktree ${worktree.path} from the ledger failed, the next start drops it:`, error),
  );
  return meta;
};
