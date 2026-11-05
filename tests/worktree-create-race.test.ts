import assert from "node:assert/strict";
import fs from "node:fs/promises";
import sync_fs from "node:fs";
import path from "node:path";
import { before, test, type TestContext } from "node:test";
import { create_worktree } from "../electron/worktrees/create.ts";
import { ledger_entries } from "../electron/worktrees/ledger.ts";
import { storage_paths } from "../electron/storage/paths.ts";
import { branch_slug } from "../electron/worktrees/naming.ts";
import { git, git_status, scratch, skip_without_git, write } from "./git-kit.ts";
import { project_repo, worktree_env, type WorktreeEnv } from "./worktree-kit.ts";

let env: WorktreeEnv;
before(async () => { if (!skip_without_git) env = await worktree_env(); });

const branches = (project: string) => git(project, "for-each-ref", "--format=%(refname:strip=2)", "refs/heads/").split(/\r?\n/).filter(Boolean);
const holder = (target: unknown) => path.dirname(String(target)) === env.worktrees && /^[0-9a-f]{8}$/i.test(path.basename(String(target)));

const simultaneous = async (t: TestContext, project: string, messages: string[]) => {
  const mkdir = fs.mkdir.bind(fs);
  const lstat = fs.lstat.bind(fs);
  let arrived = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  t.mock.method(fs, "lstat", async (target: Parameters<typeof fs.lstat>[0], options: any) => {
    if (arrived >= messages.length && holder(target)) {
      const deadline = Date.now() + 5000;
      while (git_status(project, "rev-parse", "--verify", `refs/heads/vx/${branch_slug(messages[0], "")}`) !== 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    return lstat(target, options);
  });
  t.mock.method(fs, "mkdir", async (target: Parameters<typeof fs.mkdir>[0], options: any) => {
    if (holder(target)) {
      arrived += 1;
      if (arrived === messages.length) release();
      await gate;
    }
    return mkdir(target, options);
  });
  return Promise.allSettled(messages.map((message) => create_worktree(project, project, message)));
};

test("a failed parallel creator never deletes the successful creator's branch or commit", { skip: skip_without_git }, async (t) => {
  const project = await project_repo("wt-race-survive", { "winner.txt": "keep this committed content\n" });
  const settled = await simultaneous(t, project, ["same winner", "same winner"]);
  const fulfilled = settled.filter((entry) => entry.status === "fulfilled");
  assert.ok(fulfilled.length > 0);
  for (const entry of fulfilled) {
    const tree = entry.value;
    assert.equal(git_status(project, "rev-parse", "--verify", `refs/heads/${tree.branch}`), 0, `the branch of successful worktree ${tree.path} was deleted`);
    assert.equal(git(tree.path, "rev-parse", "HEAD").trim(), tree.base);
    assert.match(await fs.readFile(path.join(tree.path, "winner.txt"), "utf8"), /^keep this committed content\r?\n$/);
  }
});

test("parallel identical titles both get distinct usable branches", { skip: skip_without_git }, async (t) => {
  const project = await project_repo("wt-race-names");
  const settled = await simultaneous(t, project, ["Add tests", "add TESTS"]);
  assert.deepEqual(settled.map((entry) => entry.status), ["fulfilled", "fulfilled"], settled.map((entry) => entry.status === "rejected" ? String(entry.reason) : "fulfilled").join("\n"));
  const created = settled.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []);
  assert.equal(new Set(created.map((tree) => tree.branch)).size, 2);
  assert.deepEqual(created.map((tree) => tree.branch).sort(), ["vx/add-tests", "vx/add-tests-2"]);
});

test("parallel different titles retain their own branch and worktree", { skip: skip_without_git }, async (t) => {
  const project = await project_repo("wt-race-different");
  const settled = await simultaneous(t, project, ["first title", "second title"]);
  assert.deepEqual(settled.map((entry) => entry.status), ["fulfilled", "fulfilled"], settled.map((entry) => entry.status === "rejected" ? String(entry.reason) : "fulfilled").join("\n"));
  for (const entry of settled) {
    if (entry.status !== "fulfilled") continue;
    assert.equal(git(project, "rev-parse", `refs/heads/${entry.value.branch}`).trim(), entry.value.base);
    assert.equal(git(entry.value.path, "rev-parse", "HEAD").trim(), entry.value.base);
  }
});

test("ledger failure leaves no branch or worktree behind", { skip: skip_without_git }, async (t) => {
  const project = await project_repo("wt-ledger-failure");
  const before = await fs.readdir(env.worktrees);
  const ledger = await ledger_entries();
  const rename = sync_fs.renameSync.bind(sync_fs);
  let failed = false;
  t.mock.method(sync_fs, "renameSync", (from: Parameters<typeof sync_fs.renameSync>[0], to: Parameters<typeof sync_fs.renameSync>[1]) => {
    if (!failed && String(to) === storage_paths().worktree_ledger) {
      failed = true;
      throw Object.assign(new Error("simulated ledger failure"), { code: "EIO" });
    }
    return rename(from, to);
  });
  await assert.rejects(create_worktree(project, project, "ledger failure"), /record in the ledger/);
  assert.deepEqual(branches(project), ["main"]);
  assert.deepEqual(await fs.readdir(env.worktrees), before);
  assert.deepEqual(await ledger_entries(), ledger);
});

test("folder creation failure leaves no reserved branch behind", { skip: skip_without_git }, async (t) => {
  const project = await project_repo("wt-folder-failure");
  const before = await fs.readdir(env.worktrees);
  const ledger = await ledger_entries();
  const mkdir = fs.mkdir.bind(fs);
  t.mock.method(fs, "mkdir", async (target: Parameters<typeof fs.mkdir>[0], options: any) => {
    if (holder(target)) throw Object.assign(new Error("simulated folder failure"), { code: "EIO" });
    return mkdir(target, options);
  });
  await assert.rejects(create_worktree(project, project, "folder failure"), /simulated folder failure/);
  assert.deepEqual(branches(project), ["main"]);
  assert.deepEqual(await fs.readdir(env.worktrees), before);
  assert.deepEqual(await ledger_entries(), ledger);
});

test("link failure removes only its own newly created branch", { skip: skip_without_git }, async (t) => {
  const project = await project_repo("wt-link-failure");
  await write(project, { "node_modules/pkg/index.js": "module.exports = 1\n" });
  git(project, "branch", "vx/link-failure");
  const before = await fs.readdir(env.worktrees);
  const ledger = await ledger_entries();
  t.mock.method(fs, "symlink", async () => { throw Object.assign(new Error("simulated link failure"), { code: "EIO" }); });
  await assert.rejects(create_worktree(project, project, "link failure"), /link node_modules/);
  assert.deepEqual(branches(project), ["main", "vx/link-failure"]);
  assert.deepEqual(await fs.readdir(env.worktrees), before);
  assert.deepEqual(await ledger_entries(), ledger);
});

test("an add failure preserves a same-base branch checked out by another owner", { skip: skip_without_git }, async (t) => {
  const project = await project_repo("wt-external-checkout", { "external.txt": "external owner\n" });
  const outside = path.join(await scratch("wt-external-holder"), "checkout");
  const base = git(project, "rev-parse", "HEAD").trim();
  const branch = "vx/external-checkout";
  const mkdir = fs.mkdir.bind(fs);
  let claimed = false;
  t.mock.method(fs, "mkdir", async (target: Parameters<typeof fs.mkdir>[0], options: any) => {
    if (!claimed && holder(target)) {
      claimed = true;
      if (git_status(project, "rev-parse", "--verify", `refs/heads/${branch}`) === 0) git(project, "worktree", "add", outside, branch);
      else git(project, "worktree", "add", "-b", branch, outside, base);
    }
    return mkdir(target, options);
  });
  await assert.rejects(create_worktree(project, project, "external checkout"), /add worktree/);
  assert.equal(git(project, "rev-parse", `refs/heads/${branch}`).trim(), base);
  assert.equal(git(outside, "rev-parse", "HEAD").trim(), base);
  assert.match(await fs.readFile(path.join(outside, "external.txt"), "utf8"), /^external owner\r?\n$/);
});
