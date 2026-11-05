import assert from "node:assert/strict";
import path from "node:path";
import { before, test } from "node:test";
import type { GitRemote } from "../shared/git-view.ts";
import { fetch_error } from "../electron/git/fetch.ts";
import { classify_push, push_branch, push_plan } from "../electron/git/push.ts";
import { git, repo_with, scratch, skip_without_git, write } from "./git-kit.ts";
import { target_of } from "./git-fetch-kit.ts";
import { identity_config, repo_view, write_guard_of } from "./git-write-kit.ts";

const options = { skip: skip_without_git };

before(async () => {
  if (!skip_without_git) await identity_config();
});

const file_url = (dir: string) => `file:///${dir.replaceAll("\\", "/")}`;

const with_remote = async (prefix: string) => {
  const local = await repo_with(prefix, { "a.txt": "a\n" });
  const bare = path.join(await scratch(`${prefix}-bare`), "r.git");
  git(local, "init", "-q", "--bare", "-b", "main", bare);
  git(local, "remote", "add", "origin", file_url(bare));
  return { local, bare };
};

const git_ref = (root: string, ref: string): string | null => {
  try {
    return git(root, "rev-parse", "--verify", "--quiet", ref).trim();
  } catch {
    return null;
  }
};

const push = async (root: string, hooks?: boolean) => push_branch(await target_of(root), await repo_view(root), await write_guard_of(root), hooks);

test("a branch without upstream is pushed with -u and then tracks the remote branch", options, async () => {
  const { local, bare } = await with_remote("push-new");
  git(local, "checkout", "-q", "-b", "feature");
  assert.deepEqual(await push(local), { kind: "done", remote: "origin", branch: "feature" });
  assert.equal(git(local, "rev-parse", "--abbrev-ref", "feature@{upstream}").trim(), "origin/feature");
  assert.equal(git(bare, "rev-parse", "feature").trim(), git(local, "rev-parse", "HEAD").trim());
});

test("with an upstream of another name the commits go to that branch", options, async () => {
  const { local, bare } = await with_remote("push-named");
  git(local, "push", "-q", "origin", "main:release");
  git(local, "fetch", "-q", "origin");
  git(local, "checkout", "-q", "-b", "work", "--track", "origin/release");
  await write(local, { "b.txt": "b\n" });
  git(local, "add", "b.txt");
  git(local, "commit", "-q", "-m", "b");
  assert.deepEqual(await push(local), { kind: "done", remote: "origin", branch: "release" });
  assert.equal(git(bare, "rev-parse", "release").trim(), git(local, "rev-parse", "HEAD").trim());
  assert.notEqual(git_ref(bare, "work"), git(local, "rev-parse", "HEAD").trim());
});

test("a remote with commits the branch does not have rejects the push", options, async () => {
  const { local, bare } = await with_remote("push-rejected");
  git(local, "push", "-q", "-u", "origin", "main");
  const other = path.join(await scratch("push-rejected-other"), "w");
  git(local, "clone", "-q", file_url(bare), other);
  await write(other, { "x.txt": "x\n" });
  git(other, "add", "x.txt");
  git(other, "commit", "-q", "-m", "x");
  git(other, "push", "-q", "origin", "main");
  await write(local, { "y.txt": "y\n" });
  git(local, "add", "y.txt");
  git(local, "commit", "-q", "-m", "y");
  assert.deepEqual(await push(local), { kind: "rejected", remote: "origin" });
});

test("a remote hook that refuses the update comes back as remote_rejected with its message", options, async () => {
  const { local, bare } = await with_remote("push-refused");
  await write(bare, { "hooks/update": "#!/bin/sh\necho 'protected branch' >&2\nexit 1\n" });
  const result = await push(local);
  assert.equal(result.kind, "remote_rejected");
  assert.equal(result.kind === "remote_rejected" && result.detail, "protected branch");
});

test("detached HEAD, an unencrypted remote or a push URL over http and repository programs block the push", options, async () => {
  const { local } = await with_remote("push-blocked");
  git(local, "checkout", "-q", "--detach");
  assert.deepEqual(await push(local), { kind: "blocked", reason: "detached" });
  git(local, "checkout", "-q", "main");
  git(local, "config", "remote.origin.pushurl", "http://example.invalid/r.git");
  assert.deepEqual(await push(local), { kind: "blocked", reason: "insecure" });
  git(local, "config", "--unset", "remote.origin.pushurl");
  git(local, "remote", "set-url", "origin", "git://example.invalid/r.git");
  assert.deepEqual(await push(local), { kind: "blocked", reason: "insecure" });
  git(local, "remote", "set-url", "origin", "https://example.invalid/r.git");
  git(local, "config", "core.sshCommand", "C:/tools/ssh.exe");
  assert.deepEqual(await push(local), { kind: "programs", keys: ["core.sshCommand"] });
});

test("a second push URL or a second URL over http blocks the push before anything is sent", options, async () => {
  const { local, bare } = await with_remote("push-urls");
  git(local, "checkout", "-q", "-b", "feature");
  git(local, "config", "--add", "remote.origin.pushurl", file_url(bare));
  git(local, "config", "--add", "remote.origin.pushurl", "http://127.0.0.1:9/leak.git");
  assert.deepEqual(await push(local), { kind: "blocked", reason: "insecure" });
  assert.equal(git_ref(bare, "feature"), null);
  git(local, "config", "--unset-all", "remote.origin.pushurl");
  git(local, "config", "--add", "remote.origin.url", "http://127.0.0.1:9/leak.git");
  assert.deepEqual(await push(local), { kind: "blocked", reason: "insecure" });
  assert.equal(git_ref(bare, "feature"), null);
  git(local, "config", "--unset", "remote.origin.url", "^http:");
  assert.deepEqual(await push(local), { kind: "done", remote: "origin", branch: "feature" });
});

test("with hooks on a failing pre-push hook comes back with its output, by default it does not run", options, async () => {
  const { local, bare } = await with_remote("push-hook");
  await write(local, { ".git/hooks/pre-push": "#!/bin/sh\necho 'tests failed' >&2\nexit 1\n" });
  const result = await push(local, true);
  assert.equal(result.kind, "hook");
  assert.match(result.kind === "hook" ? result.output : "", /tests failed/);
  assert.equal(git_ref(bare, "main"), null);
  assert.equal((await push(local)).kind, "done");
});

test("the push plan and the classification follow Git's output", () => {
  const remote: GitRemote = { name: "origin", url: "https://github.com/o/r.git", host: "github.com", host_kind: "github", slug: "o/r" };
  const plan = { remote: "origin", branch: "main", upstream: "main", args: [] };
  assert.deepEqual(classify_push(" ! [rejected]        HEAD -> main (fetch first)\nerror: failed to push some refs", plan, false), { kind: "rejected", remote: "origin" });
  assert.deepEqual(classify_push("remote: nope        \n ! [remote rejected] HEAD -> main (pre-receive hook declined)", plan, false), { kind: "remote_rejected", remote: "origin", detail: "nope" });
  assert.equal(classify_push("error: failed to push some refs to 'x'", plan, false), null);
  assert.equal(fetch_error("auth_required", remote, "fatal: could not read Username", { kind: "push", upstream: null }).command, "git push -u origin HEAD");
  assert.equal(fetch_error("auth_required", remote, "fatal: could not read Username", { kind: "push", upstream: "feature/x" }).command, "git push origin HEAD:feature/x");
  assert.equal(fetch_error("ssh_key_rejected", { ...remote, url: "git@github.com:o/r.git" }, "Permission denied (publickey)", { kind: "push", upstream: null }).command, "ssh -T git@github.com");
  assert.equal(fetch_error("auth_required", remote, "x").command, "git fetch origin");
});

test("the push plan uses the upstream branch on the remote, else the local name with -u", options, async () => {
  const { local } = await with_remote("push-plan");
  assert.deepEqual(push_plan(await repo_view(local), "origin")?.args, ["push", "--recurse-submodules=no", "-u", "--", "origin", "HEAD"]);
});
