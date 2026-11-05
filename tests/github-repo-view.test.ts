import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitRef } from "../electron/git/refs.ts";
import type { GithubSource } from "../electron/github/client.ts";
import { github_target } from "../electron/github/repo-session.ts";
import { parse_repo_info, read_round, type RepoInfo, type RoundTarget } from "../electron/github/repo-view.ts";
import type { GitRepoView } from "../shared/git-view.ts";
import { fresh_tally, reply, routed_client, sha, type Route } from "./github-kit.ts";
import { entry, repo } from "./git-view-kit.ts";

const ref = { host: "github.com", owner: "7teb", name: "VantheaX" };

const info: RepoInfo = { repo: ref, html_url: "https://github.com/7teb/VantheaX", default_branch: "main", visibility: "private", archived: false, fork_parent: null, renamed_from: null };

const anonymous: GithubSource = { kind: "anonymous" };

const base = "repos/7teb/VantheaX";

const pulls = (owner_repo: string, head: string) => `repos/${owner_repo}/pulls?head=${encodeURIComponent(head)}&state=all&sort=created&direction=desc&per_page=1`;

const round = (routes: Record<string, Route>, target: RoundTarget, source: GithubSource = anonymous, repo_info: RepoInfo = info) =>
  read_round({ client: routed_client(routes, routes), source, info: repo_info, target, signal: new AbortController().signal, tally: fresh_tally() });

const branch_at = (commit: string) => reply(200, { name: "main", commit: { sha: commit } });

test("repository info keeps visibility, fork parent, archive state and notices a rename", () => {
  const parsed = parse_repo_info({ full_name: "7teb/VantheaX2", private: true, archived: true, fork: true, parent: { full_name: "acme/vanthea" }, html_url: "https://github.com/7teb/VantheaX2" }, ref);
  assert.deepEqual(parsed, {
    repo: { host: "github.com", owner: "7teb", name: "VantheaX2" },
    html_url: "https://github.com/7teb/VantheaX2",
    default_branch: null,
    visibility: "private",
    archived: true,
    fork_parent: "acme/vanthea",
    renamed_from: "7teb/VantheaX",
  });
  assert.equal(parse_repo_info({ full_name: "7teb/vantheax", visibility: "public", html_url: "http://github.com/x" }, ref).renamed_from, null);
  assert.equal(parse_repo_info({ full_name: "7teb/vantheax", visibility: "public", html_url: "http://github.com/x" }, ref).html_url, null);
  assert.throws(() => parse_repo_info({ full_name: "../etc" }, ref), /without a usable full_name/);
});

test("repository info keeps a usable default branch and drops a missing or malformed one", () => {
  const default_of = (value: unknown) => parse_repo_info({ full_name: "7teb/VantheaX", default_branch: value }, ref).default_branch;
  assert.equal(default_of("main"), "main");
  assert.equal(default_of("release/2.x"), "release/2.x");
  assert.equal(default_of(undefined), null);
  assert.equal(default_of(""), null);
  assert.equal(default_of(42), null);
  assert.equal(default_of("-x"), null);
  assert.equal(default_of("a b"), null);
  assert.equal(default_of("a..b"), null);
  assert.equal(default_of("a\u0000b"), null);
});

test("the branch on GitHub compares GitHub's head with the remote-tracking ref", async () => {
  const same = await round({ [`${base}/branches/main`]: branch_at(sha("a")) }, { branch: "main", tracking: sha("a") });
  assert.deepEqual(same.kind === "data" ? same.branch : same, { kind: "same", sha: sha("a") });
  const ahead = await round(
    { [`${base}/branches/main`]: branch_at(sha("b")), [`${base}/compare/${sha("a")}...${sha("b")}?per_page=1`]: reply(200, { status: "ahead", ahead_by: 3, behind_by: 0 }) },
    { branch: "main", tracking: sha("a") },
  );
  assert.deepEqual(ahead.kind === "data" ? ahead.branch : ahead, { kind: "remote_ahead", count: 3 });
  assert.equal(ahead.kind === "data" ? ahead.remote_sha : null, sha("b"));
  for (const compare of [reply(404, { message: "Not Found" }), reply(422, { message: "No common ancestor" }), reply(200, { status: "diverged", ahead_by: 2, behind_by: 1 })]) {
    const rewritten = await round({ [`${base}/branches/main`]: branch_at(sha("b")), [`${base}/compare/${sha("a")}...${sha("b")}?per_page=1`]: compare }, { branch: "main", tracking: sha("a") });
    assert.deepEqual(rewritten.kind === "data" ? rewritten.branch : rewritten, { kind: "rewritten" });
  }
  const missing = await round({}, { branch: "main", tracking: null });
  assert.deepEqual(missing.kind === "data" ? missing.branch : missing, { kind: "missing" });
  const unfetched = await round({ [`${base}/branches/main`]: branch_at(sha("c")) }, { branch: "main", tracking: null });
  assert.deepEqual(unfetched.kind === "data" ? unfetched.branch : unfetched, { kind: "unfetched" });
});

test("a detached HEAD reads only the repository row", async () => {
  const calls: string[] = [];
  const result = await read_round({
    client: routed_client({ "x": (call) => (calls.push(call.path), reply(200, {})) }),
    source: anonymous,
    info,
    target: { branch: null, tracking: null },
    signal: new AbortController().signal,
    tally: fresh_tally(),
  });
  assert.deepEqual(result, { kind: "data", branch: { kind: "none" }, pr: null, checks: null, remote_sha: null });
  assert.deepEqual(calls, []);
});

test("a fork's pull request is found in the parent, with reviews and the checks of its head from the parent", async () => {
  const fork: RepoInfo = { ...info, fork_parent: "acme/vanthea" };
  const head = sha("d");
  const result = await round(
    {
      [`${base}/branches/feat/x`]: branch_at(sha("c")),
      [pulls("acme/vanthea", "7teb:feat/x")]: reply(200, [
        { number: 12, title: "Add the thing", state: "open", draft: false, merged_at: null, html_url: "https://github.com/acme/vanthea/pull/12", head: { sha: head }, requested_reviewers: [{ login: "dora" }], requested_teams: [] },
      ]),
      ["repos/acme/vanthea/pulls/12/reviews?per_page=100"]: reply(200, [{ user: { login: "ana" }, state: "APPROVED" }]),
      [`repos/acme/vanthea/commits/${head}/check-runs?per_page=100`]: reply(200, { total_count: 1, check_runs: [{ name: "build", status: "completed", conclusion: "success", app: { slug: "github-actions" } }] }),
      [`${base}/commits/${head}/check-runs?per_page=100`]: reply(200, { total_count: 1, check_runs: [{ name: "fork push", status: "completed", conclusion: "failure" }] }),
    },
    { branch: "feat/x", tracking: sha("c") },
    anonymous,
    fork,
  );
  assert.equal(result.kind, "data");
  if (result.kind !== "data") return;
  assert.deepEqual(result.pr, { number: 12, title: "Add the thing", state: "open", html_url: "https://github.com/acme/vanthea/pull/12", reviews: { approved: 1, changes_requested: 0, pending: 1 } });
  assert.equal(result.checks?.state, "passed");
  assert.deepEqual(result.checks?.counts, { failed: 0, action_required: 0, running: 0, passed: 1, skipped: 0 });
});

test("merged, closed and draft pull requests keep their state, checks are counted over all pages", async () => {
  const head = sha("e");
  const pr = (extra: object) => reply(200, [{ number: 3, title: "T", state: "open", draft: false, merged_at: null, html_url: "https://github.com/7teb/VantheaX/pull/3", head: { sha: head }, ...extra }]);
  const routes = (pulls_reply: Route): Record<string, Route> => ({
    [`${base}/branches/main`]: branch_at(head),
    [pulls("7teb/VantheaX", "7teb:main")]: pulls_reply,
    [`${base}/commits/${head}/check-runs?per_page=100`]: reply(200, { total_count: 3, check_runs: [{ name: "a", status: "completed", conclusion: "success" }, { name: "b", status: "in_progress", conclusion: null }] }, { link: `<https://api.github.com/repositories/1/commits/${head}/check-runs?per_page=100&page=2>; rel="next"` }),
    [`repositories/1/commits/${head}/check-runs?per_page=100&page=2`]: reply(200, { total_count: 3, check_runs: [{ name: "c", status: "completed", conclusion: "failure" }] }),
    [`${base}/commits/${head}/status?per_page=100`]: reply(200, { state: "pending", total_count: 0, statuses: [] }),
    [`${base}/actions/runs?head_sha=${head}&per_page=100`]: reply(200, { total_count: 0, workflow_runs: [] }),
  });
  for (const [extra, state] of [[{ merged_at: "2026-10-01T10:00:00Z", state: "closed" }, "merged"], [{ state: "closed" }, "closed"], [{ draft: true }, "draft"]] as const) {
    const result = await round(routes(pr(extra)), { branch: "main", tracking: head });
    assert.equal(result.kind === "data" ? result.pr?.state : result.kind, state);
    assert.deepEqual(result.kind === "data" ? result.checks?.counts : null, { failed: 1, action_required: 0, running: 1, passed: 1, skipped: 0 });
  }
});

test("a revoked token loses the source, offline ends the round as trouble", async () => {
  const lost = await round({ [`${base}/branches/main`]: reply(401, { message: "Bad credentials" }) }, { branch: "main", tracking: null }, { kind: "gh", login: "octo" });
  assert.deepEqual(lost, { kind: "lost" });
  const trouble = await round({ [`${base}/branches/main`]: reply(502, "") }, { branch: "main", tracking: null });
  assert.deepEqual(trouble, { kind: "trouble", trouble: { kind: "server_error", status: 502 } });
});

const remote_ref = (name: string, hash: string): GitRef => ({ name, kind: "remote", hash, target: hash, upstream: null, track: null, head: false, worktree: null });

test("the GitHub target follows the primary remote, its upstream branch and the remote-tracking ref", () => {
  const view: GitRepoView = repo(
    { entries: [entry("a.txt", "modified")], remotes: [{ name: "origin", url: "git@ssh.github.com:7teb/VantheaX.git", host: "ssh.github.com", host_kind: "github", slug: "7teb/VantheaX" }] },
    { name: "local-name", upstream: "origin/feat/x", ahead: 1 },
  );
  assert.deepEqual(github_target(view, [remote_ref("origin/feat/x", sha("f"))]), {
    repo: { host: "github.com", owner: "7teb", name: "VantheaX" },
    host_kind: "github",
    remote: "origin",
    remote_url: "git@ssh.github.com:7teb/VantheaX.git",
    branch: "feat/x",
    tracking: sha("f"),
  });
  const detached = github_target({ ...view, branch: { ...view.branch, name: null, upstream: null } }, []);
  assert.equal(detached?.branch, null);
  const gitlab = github_target({ ...view, remotes: [{ name: "origin", url: "https://gitlab.com/g/r", host: "gitlab.com", host_kind: "other", slug: "g/r" }] }, []);
  assert.equal(gitlab?.host_kind, "other");
  assert.equal(github_target({ ...view, remotes: [{ name: "origin", url: "D:/bare", host: null, host_kind: "local", slug: null }] }, []), null);
  assert.equal(github_target({ kind: "none" }, []), null);
});
