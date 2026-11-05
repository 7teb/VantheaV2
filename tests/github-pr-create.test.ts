import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitOutput } from "../electron/git/run.ts";
import { classify_pr_create, create_pull_request, pr_create_args, require_default_base } from "../electron/github/pr-create.ts";

const repo = { host: "github.com", owner: "7teb", name: "VantheaX" };

const request = { title: "Add the commit box", body: "Body\n\n- one", base: "main" };

const out = (code: number, stdout: string, stderr = ""): GitOutput => ({ code, stdout: Buffer.from(stdout), stderr });

test("the gh arguments name the repository, head, base, title and body and nothing that pushes", () => {
  assert.deepEqual(pr_create_args({ repo, head: "vx/commit-box" }, request), [
    "pr",
    "create",
    "--repo",
    "github.com/7teb/VantheaX",
    "--head",
    "vx/commit-box",
    "--base",
    "main",
    "--title",
    "Add the commit box",
    "--body",
    "Body\n\n- one",
  ]);
  assert.deepEqual(pr_create_args({ repo: { host: "acme.ghe.com", owner: "acme", name: "tools" }, head: "x" }, request).slice(2, 4), ["--repo", "acme.ghe.com/acme/tools"]);
});

test("gh output becomes the result: the link, an existing pull request, no commits, sign-in, other failures", () => {
  assert.deepEqual(classify_pr_create(out(0, "https://github.com/7teb/VantheaX/pull/42\n"), repo), { kind: "done", url: "https://github.com/7teb/VantheaX/pull/42", number: 42 });
  assert.equal(classify_pr_create(out(0, "created\n"), repo).kind, "failed");
  assert.deepEqual(
    classify_pr_create(out(1, "", 'a pull request for branch "x" into branch "main" already exists:\nhttps://github.com/7teb/VantheaX/pull/7\n'), repo),
    { kind: "exists", url: "https://github.com/7teb/VantheaX/pull/7" },
  );
  assert.deepEqual(classify_pr_create(out(1, "", "pull request create failed: GraphQL: No commits between main and x (createPullRequest)"), repo), { kind: "no_commits" });
  assert.deepEqual(classify_pr_create(out(4, "", "To get started with GitHub CLI, please run:  gh auth login"), repo), { kind: "cli", cli: { state: "signed_out", version: null }, command: "gh auth login" });
  assert.deepEqual(classify_pr_create(out(4, "", "not logged in"), { ...repo, host: "acme.ghe.com" }), { kind: "cli", cli: { state: "signed_out", version: null }, command: "gh auth login --hostname acme.ghe.com" });
  assert.deepEqual(classify_pr_create(out(1, "", "error: Head sha can't be blank"), repo), { kind: "failed", error: "error: Head sha can't be blank" });
});

test("create_pull_request runs gh with the built arguments", async () => {
  const seen: { exe: string; args: string[] }[] = [];
  const result = await create_pull_request(
    async (exe, args) => {
      seen.push({ exe, args });
      return out(0, "https://github.com/7teb/VantheaX/pull/9\n");
    },
    "C:/gh/gh.exe",
    { repo, head: "feature" },
    request,
  );
  assert.deepEqual(result, { kind: "done", url: "https://github.com/7teb/VantheaX/pull/9", number: 9 });
  assert.equal(seen[0]?.exe, "C:/gh/gh.exe");
  assert.deepEqual(seen[0]?.args.slice(0, 6), ["pr", "create", "--repo", "github.com/7teb/VantheaX", "--head", "feature"]);
});

test("a pull request base other than the repository's default branch is refused", () => {
  assert.doesNotThrow(() => require_default_base(request, { repo, default_branch: "main" }));
  assert.throws(() => require_default_base({ ...request, base: "develop" }, { repo, default_branch: "main" }), /base develop is not the default branch main of 7teb\/VantheaX/);
  assert.throws(() => require_default_base(request, { repo, default_branch: null }), /not the default branch \(unknown\)/);
});
