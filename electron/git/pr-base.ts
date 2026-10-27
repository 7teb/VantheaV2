import { tracked_branch } from "../../shared/git/push-state.ts";
import type { GitReadAccess } from "./diff.ts";
import { exec_git, git_ok } from "./run.ts";

export type PrBase = { base_ref: string; ahead: number; unpushed: number };

export const read_pr_base = async (access: GitReadAccess, remote: string, base: string): Promise<PrBase | null> => {
  const top = access.view.repo.root;
  const run = (args: string[]) => exec_git(access.tool, { cwd: top, args, config: access.config, signal: access.signal });
  const base_ref = `refs/remotes/${remote}/${base}`;
  if ((await run(["rev-parse", "--verify", "--quiet", `${base_ref}^{commit}`])).code !== 0) {
    return null;
  }
  const count = async (revs: string[]): Promise<number> => Number(git_ok(await run(["rev-list", "--count", ...revs, "--"]), `git rev-list --count ${revs.join(" ")} in ${top}`).toString("utf8").trim());
  const { branch } = access.view;
  const [ahead, unpushed] = await Promise.all([count([`${base_ref}..HEAD`]), tracked_branch(access.view, remote) !== null && branch.ahead !== null ? branch.ahead : count(["HEAD", "--not", `--remotes=${remote}`])]);
  return { base_ref, ahead, unpushed };
};
