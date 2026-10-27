import type { GithubData, GithubRepoRef } from "../../shared/github-view.ts";
import type { CreatePrResult, PrRequest } from "../../shared/ipc/git-actions.ts";
import { error_line, type GitOutput } from "../git/run.ts";
import { login_command } from "./access.ts";
import type { GhRun } from "./gh-cli.ts";

export type PrTarget = { repo: GithubRepoRef; head: string };

const escaped = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const require_default_base = (request: PrRequest, data: Pick<GithubData, "repo" | "default_branch">) => {
  if (request.base !== data.default_branch) {
    throw new Error(`pull request base ${request.base} is not the default branch ${data.default_branch ?? "(unknown)"} of ${data.repo.owner}/${data.repo.name}`);
  }
};

export const pr_create_args = (target: PrTarget, request: PrRequest): string[] => [
  "pr",
  "create",
  "--repo",
  `${target.repo.host}/${target.repo.owner}/${target.repo.name}`,
  "--head",
  target.head,
  "--base",
  request.base,
  "--title",
  request.title,
  "--body",
  request.body,
];

const pr_link = (text: string, repo: GithubRepoRef): { url: string; number: number } | null => {
  const match = new RegExp(`https://${escaped(repo.host)}/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/pull/(\\d+)`, "i").exec(text);
  return match ? { url: match[0], number: Number(match[1]) } : null;
};

export const classify_pr_create = (output: GitOutput, repo: GithubRepoRef): CreatePrResult => {
  const stdout = output.stdout.toString("utf8");
  if (output.code === 0) {
    const link = pr_link(stdout, repo);
    return link ? { kind: "done", ...link } : { kind: "failed", error: `gh pr create printed no pull request link: ${stdout.trim().slice(0, 200) || "no output"}` };
  }
  const text = `${output.stderr}\n${stdout}`;
  if (output.code === 4) return { kind: "cli", cli: { state: "signed_out", version: null }, command: login_command(repo.host) };
  if (/already exists/i.test(text)) return { kind: "exists", url: pr_link(text, repo)?.url ?? null };
  if (/No commits between/i.test(text)) return { kind: "no_commits" };
  return { kind: "failed", error: error_line(output.stderr) || `gh pr create exited with ${output.code}` };
};

export const create_pull_request = async (run: GhRun, exe: string, target: PrTarget, request: PrRequest): Promise<CreatePrResult> =>
  classify_pr_create(await run(exe, pr_create_args(target, request)), target.repo);
