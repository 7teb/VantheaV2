import type { CreatePrResult, PrCli, PrRequest, PrTextResult } from "../../shared/ipc/git-actions.ts";
import { pr_head, push_needed } from "../../shared/git/push-state.ts";
import { git_service } from "../git/index.ts";
import { git_text_room, pr_text_system, split_pr_text, write_git_text } from "../side/git-text.ts";
import { error_text } from "../storage/coerce.ts";
import { login_command } from "./access.ts";
import { cli_of, run_gh } from "./gh-cli.ts";
import { github_service } from "./index.ts";
import { create_pull_request, require_default_base } from "./pr-create.ts";

type Ready = { exe: string } | PrCli;

const bound_of = (root: string) => {
  const bound = github_service.bound_target(root);
  if (!bound) {
    throw new Error(`the Files panel shows no GitHub data for ${root}`);
  }
  return bound;
};

const cli_ready = async (host: string): Promise<Ready> => {
  const status = await github_service.cli_status(host);
  const cli = cli_of(status, host);
  if (cli.state === "ready" && status.kind === "found") return { exe: status.exe };
  return { kind: "cli", cli, command: cli.state === "signed_out" ? login_command(host) : null };
};

export const write_pr = async (root: string): Promise<PrTextResult> => {
  try {
    const { target, data } = bound_of(root);
    const ready = await cli_ready(data.repo.host);
    if ("kind" in ready) return ready;
    if (data.default_branch === null) {
      return { kind: "failed", error: `GitHub named no default branch for ${data.repo.owner}/${data.repo.name}` };
    }
    const base = await git_service.pr_base(root, target.remote, data.default_branch);
    if (!base) {
      return { kind: "failed", error: `${target.remote}/${data.default_branch} is not fetched yet` };
    }
    if (base.ahead === 0) return { kind: "no_commits" };
    const view = git_service.repo_view(root);
    const material = await git_service.branch_material(root, base.base_ref, await git_text_room(pr_text_system));
    const text = split_pr_text(await write_git_text(pr_text_system, material));
    return { kind: "text", ...text, base: data.default_branch, push_first: view && push_needed(view) ? base.unpushed : null };
  } catch (error) {
    console.error(`[github] writing the pull request text for ${root} failed:`, error);
    return { kind: "failed", error: error_text(error) };
  }
};

export const create_pr = async (root: string, request: PrRequest): Promise<CreatePrResult> => {
  const { data } = bound_of(root);
  require_default_base(request, data);
  if (await git_service.checkout_busy(root)) return { kind: "busy" };
  const ready = await cli_ready(data.repo.host);
  if ("kind" in ready) return ready;
  const view = git_service.repo_view(root);
  const head = view && pr_head(view);
  if (!view || !head) {
    return { kind: "failed", error: `${root} is not on a branch` };
  }
  let branch = head;
  if (push_needed(view)) {
    const pushed = await git_service.push(root);
    if (pushed.kind !== "done") return { kind: "push", result: pushed };
    branch = pushed.branch;
  }
  const result = await create_pull_request(run_gh, ready.exe, { repo: data.repo, head: branch }, request);
  if (result.kind === "done") github_service.refresh(root);
  else console.warn(`[github] gh pr create for ${data.repo.owner}/${data.repo.name} from ${branch} ended with ${result.kind}`);
  return result;
};
