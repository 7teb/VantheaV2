import type { GitRepoView } from "../../shared/git-view.ts";
import type { PushResult } from "../../shared/ipc/git-actions.ts";
import { tracked_branch } from "../../shared/git/push-state.ts";
import { strip_userinfo } from "../../shared/git/remote-url.ts";
import { classify_fetch, fetch_error, insecure_scheme, type FetchTarget } from "./fetch.ts";
import { exec_git, first_line, git_ok, write_hooks } from "./run.ts";
import { fetch_ssh_command } from "./ssh.ts";
import type { RepoWriteGuard } from "./write-guard.ts";

export type PushPlan = { remote: string; branch: string; upstream: string | null; args: string[] };

const output_lines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => strip_userinfo(line.trim()))
    .filter(Boolean);

export const push_plan = (view: GitRepoView, remote: string): PushPlan | null => {
  const name = view.branch.name;
  if (name === null) return null;
  const tracked = tracked_branch(view, remote);
  if (tracked) return { remote, branch: tracked, upstream: tracked, args: ["push", "--recurse-submodules=no", "--", remote, `HEAD:refs/heads/${tracked}`] };
  return { remote, branch: name, upstream: null, args: ["push", "--recurse-submodules=no", "-u", "--", remote, "HEAD"] };
};

export const classify_push = (output: string, plan: PushPlan, hooks: boolean): Exclude<PushResult, { kind: "done" | "busy" | "blocked" | "programs" | "error" }> | null => {
  const lines = output_lines(output);
  const refused = lines.find((line) => line.includes("[remote rejected]"));
  if (refused) {
    const said = lines.find((line) => /^remote:\s*\S/.test(line) && !/^remote:\s*error: hook declined/i.test(line));
    return { kind: "remote_rejected", remote: plan.remote, detail: said?.replace(/^remote:\s*/, "") ?? refused };
  }
  if (lines.some((line) => /\[rejected\]|non-fast-forward|fetch first/.test(line))) return { kind: "rejected", remote: plan.remote };
  if (hooks && lines.some((line) => /failed to push some refs/i.test(line))) return { kind: "hook", output: lines.filter((line) => !/failed to push some refs/i.test(line)).join("\n") };
  return null;
};

const blocked_reason = (view: GitRepoView): Extract<PushResult, { kind: "blocked" }>["reason"] | null => {
  if (view.operation) return "operation";
  if (view.branch.name === null) return "detached";
  if (view.branch.unborn || view.head === null) return "unborn";
  return null;
};

export const push_branch = async (target: FetchTarget, view: GitRepoView, guard: RepoWriteGuard, hooks = write_hooks): Promise<PushResult> => {
  const reason = blocked_reason(view);
  if (reason) return { kind: "blocked", reason };
  if (guard.push_block.length > 0) return { kind: "programs", keys: guard.push_block };
  const plan = push_plan(view, target.remote.name);
  if (!plan) return { kind: "blocked", reason: "detached" };
  const config = target.guard.read_config;
  const push_urls = git_ok(await exec_git(target.tool, { cwd: target.top, args: ["remote", "get-url", "--push", "--all", "--", plan.remote], config }), `git remote get-url --push --all ${plan.remote}`)
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (insecure_scheme(target.remote.url) || push_urls.some((url) => insecure_scheme(url))) return { kind: "blocked", reason: "insecure" };
  const output = await exec_git(target.tool, {
    cwd: target.top,
    args: plan.args,
    config,
    env: { GIT_SSH_COMMAND: fetch_ssh_command(process.env, target.guard.ssh) },
    hooks,
  });
  if (output.code === 0) return { kind: "done", remote: plan.remote, branch: plan.branch };
  const text = `${output.stderr}\n${output.stdout.toString("utf8")}`;
  const known = classify_push(text, plan, hooks && guard.hooks);
  if (known) return known;
  const kind = classify_fetch(output.stderr);
  return { kind: "error", error: fetch_error(kind === "busy" ? "error" : kind, target.remote, first_line(output.stderr) || `git push exited with ${output.code}`, { kind: "push", upstream: plan.upstream }) };
};
