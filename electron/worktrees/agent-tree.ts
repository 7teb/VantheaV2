import { require_git_tool } from "../git/locate.ts";
import { entry_kind, fsmonitor_off } from "../git/repo.ts";
import { exec_git, git_ok } from "../git/run.ts";
import { ledger_add, ledger_drop, type LedgerBranch } from "./ledger.ts";
import { remove_worktree_folder } from "./remove.ts";
import { count_status } from "./work.ts";

export type AgentTree = { path: string; project_path: string; branch: LedgerBranch };

export const track_agent_tree = (tree: AgentTree): Promise<void> =>
  ledger_add({ path: tree.path, project_path: tree.project_path, state: "agent", at: new Date().toISOString(), branch: tree.branch });

const unchanged = async (tree: AgentTree): Promise<boolean> => {
  const tool = await require_git_tool();
  const status = await exec_git(tool, { cwd: tree.path, args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"], flags: fsmonitor_off });
  if (count_status(git_ok(status, `git status in ${tree.path}`).toString("utf8")) > 0) {
    return false;
  }
  const head = await exec_git(tool, { cwd: tree.path, args: ["rev-parse", "HEAD"], flags: fsmonitor_off });
  return git_ok(head, `git rev-parse HEAD in ${tree.path}`).toString("utf8").trim() === tree.branch.base;
};

const drop_branch = async (tree: AgentTree): Promise<void> => {
  const tool = await require_git_tool();
  const { name, base, repo_dir } = tree.branch;
  const dropped = await exec_git(tool, { cwd: repo_dir, args: ["update-ref", "-d", `refs/heads/${name}`, base], flags: fsmonitor_off });
  if (dropped.code !== 0) {
    console.warn(`[worktrees] the branch ${name} of the removed agent worktree ${tree.path} stays: ${dropped.stderr.trim()}`);
  }
};

export const remove_agent_tree = async (tree: AgentTree): Promise<void> => {
  await ledger_add({ path: tree.path, project_path: tree.project_path, state: "removing", at: new Date().toISOString(), branch: tree.branch });
  await remove_worktree_folder(tree.project_path, tree.path);
  await drop_branch(tree);
  await ledger_drop(tree.path);
};

export const settle_agent_tree = async (tree: AgentTree): Promise<boolean> => {
  if ((await entry_kind(tree.path)) !== null && !(await unchanged(tree))) {
    await ledger_drop(tree.path);
    return true;
  }
  await remove_agent_tree(tree);
  return false;
};
