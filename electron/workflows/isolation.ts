import { worktree_dir } from "../chats/workspace.ts";
import { error_text } from "../storage/coerce.ts";
import { remove_agent_tree, settle_agent_tree, track_agent_tree, type AgentTree } from "../worktrees/agent-tree.ts";
import { create_worktree } from "../worktrees/create.ts";

export type AgentWorktree = { path: string; dir: string; branch: string; base: string; project_path: string; repo_dir: string };

const ledger_tree = (tree: AgentWorktree): AgentTree => ({ path: tree.path, project_path: tree.project_path, branch: { name: tree.branch, base: tree.base, repo_dir: tree.repo_dir } });

export const create_agent_worktree = async (project_path: string, project_root: string, seed: string): Promise<AgentWorktree> => {
  const worktree = await create_worktree(project_path, project_root, seed);
  const tree: AgentWorktree = { path: worktree.path, dir: worktree_dir(worktree), branch: worktree.branch, base: worktree.base, project_path, repo_dir: project_root };
  try {
    await track_agent_tree(ledger_tree(tree));
  } catch (error) {
    await remove_agent_tree(ledger_tree(tree)).catch((cleanup: unknown) =>
      console.error(`[workflows] removing the untracked agent worktree ${tree.path} failed, the next start removes it:`, cleanup),
    );
    throw new Error(`recording the agent worktree ${tree.path} in the worktree ledger failed: ${error_text(error)}`, { cause: error });
  }
  return tree;
};

export const release_agent_worktree = (tree: AgentWorktree): Promise<boolean> => settle_agent_tree(ledger_tree(tree));
