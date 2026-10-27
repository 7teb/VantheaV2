import path from "node:path";
import type { WorktreeEligibility } from "../../shared/ipc/worktrees.ts";
import { git_tool, minimum_git, version_at_least } from "../git/locate.ts";
import { detect_repo, entry_kind, fsmonitor_off, type RepoPaths } from "../git/repo.ts";
import { error_line, exec_git, git_ok, type GitTool } from "../git/run.ts";
import { read_owned_filters } from "../git/write-guard.ts";
import { error_text } from "../storage/coerce.ts";

export type RepoReady = { kind: "ready"; tool: GitTool; paths: RepoPaths; prefix: string; base: string; branch: string | null; submodules: boolean };

export type RepoCheck = RepoReady | Exclude<WorktreeEligibility, { kind: "ready" }>;

const head_commit = async (tool: GitTool, top: string): Promise<string | null> => {
  const output = await exec_git(tool, { cwd: top, args: ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], flags: fsmonitor_off });
  if (output.code === 0) {
    return output.stdout.toString("utf8").trim();
  }
  if (output.stderr.trim()) {
    throw new Error(`git rev-parse HEAD in ${top} exited with ${output.code}: ${error_line(output.stderr)}`);
  }
  return null;
};

const current_branch = async (tool: GitTool, top: string): Promise<string | null> => {
  const output = await exec_git(tool, { cwd: top, args: ["symbolic-ref", "--short", "-q", "HEAD"], flags: fsmonitor_off });
  if (output.code === 1) {
    return null;
  }
  return git_ok(output, `git symbolic-ref HEAD in ${top}`).toString("utf8").trim() || null;
};

const in_head = async (tool: GitTool, top: string, prefix: string): Promise<boolean> => {
  const output = await exec_git(tool, { cwd: top, args: ["ls-tree", "--name-only", "HEAD", "--", prefix], flags: fsmonitor_off, literal_paths: true });
  return git_ok(output, `git ls-tree HEAD -- ${prefix} in ${top}`).toString("utf8").trim() !== "";
};

export const inspect_repo = async (project_dir: string): Promise<RepoCheck> => {
  const found = await git_tool();
  if (found.kind === "missing" || !version_at_least(found.tool.numbers, minimum_git)) {
    return { kind: "git_missing" };
  }
  const { tool } = found;
  const detected = await detect_repo(tool, project_dir);
  if (detected.kind === "none") {
    return { kind: "not_repo" };
  }
  if (detected.kind === "ownership") {
    return { kind: "failed", error: `Git refuses the repository at ${detected.path} because another Windows user owns it` };
  }
  if (detected.kind === "error") {
    return { kind: "failed", error: detected.message };
  }
  const { paths } = detected;
  const base = await head_commit(tool, paths.top);
  if (base === null) {
    return { kind: "no_commits" };
  }
  const prefix = paths.prefix.replace(/\/+$/, "");
  if (prefix && !(await in_head(tool, paths.top, prefix))) {
    return { kind: "untracked_folder" };
  }
  const filters = await read_owned_filters(tool, paths.top);
  if (filters.length > 0) {
    return { kind: "programs", keys: filters };
  }
  const branch = await current_branch(tool, paths.top);
  const submodules = (await entry_kind(path.join(paths.top, ".gitmodules"))) === "file";
  return { kind: "ready", tool, paths, prefix, base, branch, submodules };
};

export const programs_refusal = (keys: string[]): string => `Repository configuration starts programs (${keys.join(", ")}), use a terminal`;

export const refusal_text = (check: Exclude<RepoCheck, RepoReady>): string => {
  switch (check.kind) {
    case "programs":
      return programs_refusal(check.keys);
    case "git_missing":
      return `Git for Windows ${minimum_git.join(".")} or newer is not installed`;
    case "not_repo":
      return "the project folder is not inside a Git repository";
    case "no_commits":
      return "the repository has no commit yet";
    case "untracked_folder":
      return "the project folder is not in the last commit";
    case "failed":
      return check.error;
  }
};

export const worktree_eligibility = async (project_dir: string): Promise<WorktreeEligibility> => {
  try {
    const check = await inspect_repo(project_dir);
    return check.kind === "ready" ? { kind: "ready", branch: check.branch, submodules: check.submodules } : check;
  } catch (error) {
    console.error(`[worktrees] checking whether ${project_dir} can get a worktree failed:`, error);
    return { kind: "failed", error: error_text(error) };
  }
};
