import { require_git_tool } from "../git/locate.ts";
import { entry_kind, fsmonitor_off } from "../git/repo.ts";
import { exec_git, git_ok } from "../git/run.ts";
import { path_key } from "../storage/paths.ts";

export const repair_worktrees = async (main_dir: string, paths: string[]): Promise<void> => {
  const present: string[] = [];
  for (const dir of new Map(paths.map((entry) => [path_key(entry), entry])).values()) {
    if ((await entry_kind(dir)) === "dir") {
      present.push(dir);
    }
  }
  if (present.length === 0) {
    return;
  }
  try {
    const tool = await require_git_tool();
    git_ok(await exec_git(tool, { cwd: main_dir, args: ["worktree", "repair", ...present], flags: fsmonitor_off }), `git worktree repair in ${main_dir}`);
    console.info(`[worktrees] repaired ${present.length} worktree links after ${main_dir} was renamed`);
  } catch (error) {
    console.error(`[worktrees] repairing the worktrees ${present.join(", ")} of ${main_dir} failed:`, error);
  }
};
