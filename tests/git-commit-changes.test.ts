import assert from "node:assert/strict";
import { existsSync, watch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { before, test } from "node:test";
import { classify_commit, commit_changes } from "../electron/git/commit-changes.ts";
import { git, git_status, repo_with, scratch, skip_without_git, write } from "./git-kit.ts";
import { access_of, identity_config, write_guard_of } from "./git-write-kit.ts";

const options = { skip: skip_without_git };

before(async () => {
  if (!skip_without_git) await identity_config();
});

const commit = async (root: string, message: string, hooks?: boolean) => commit_changes(await access_of(root), await write_guard_of(root), message, hooks);

const status = (root: string) => git(root, "status", "--porcelain=v1", "--untracked-files=all").trim();

test("commit takes modified, deleted and new files of the folder and returns the new head", options, async () => {
  const root = await repo_with("commit-all", { "a.txt": "a\n", "gone.txt": "g\n" });
  await write(root, { "a.txt": "changed\n", "new/b.txt": "b\n" });
  await fs.rm(path.join(root, "gone.txt"));
  const result = await commit(root, "Change a, drop gone, add b");
  assert.equal(result.kind, "done");
  assert.equal(result.kind === "done" && result.hash, git(root, "rev-parse", "HEAD").trim());
  assert.deepEqual(result.kind === "done" && result.left_out, []);
  assert.equal(status(root), "");
  assert.equal(git(root, "log", "-1", "--format=%s").trim(), "Change a, drop gone, add b");
  assert.deepEqual(git(root, "show", "--name-status", "--format=", "HEAD").trim().split("\n").sort(), ["A\tnew/b.txt", "D\tgone.txt", "M\ta.txt"]);
});

test("a subfolder project commits only its own files and leaves staged files outside it staged", options, async () => {
  const root = await repo_with("commit-sub", { "app/a.txt": "a\n", "other/o.txt": "o\n" });
  await write(root, { "app/a.txt": "a2\n", "other/o.txt": "o2\n" });
  git(root, "add", "other/o.txt");
  const result = await commit(path.join(root, "app"), "Change app");
  assert.equal(result.kind, "done");
  assert.deepEqual(git(root, "show", "--name-only", "--format=", "HEAD").trim(), "app/a.txt");
  assert.equal(status(root), "M  other/o.txt");
});

test("an untracked secret file stays out of the commit and is named, a tracked one is committed", options, async () => {
  const root = await repo_with("commit-secret", { "config/.env.local": "OLD=1\n", "a.txt": "a\n" });
  await write(root, { ".env": "TOKEN=x\n", "config/.env.local": "NEW=2\n", "a.txt": "b\n", "inner/x.txt": "x\n" });
  git(path.join(root, "inner"), "init", "-q");
  git(path.join(root, "inner"), "add", "-A");
  git(path.join(root, "inner"), "commit", "-q", "-m", "inner");
  const result = await commit(root, "Update config");
  assert.equal(result.kind, "done");
  assert.deepEqual(result.kind === "done" && result.left_out.sort(), [".env", "inner/"]);
  assert.deepEqual(git(root, "show", "--name-only", "--format=", "HEAD").trim().split("\n").sort(), ["a.txt", "config/.env.local"]);
  assert.equal(status(root), "?? .env\n?? inner/");
});

test("a new secret file that is already staged stays out of the commit, stays staged and is named", options, async () => {
  const root = await repo_with("commit-staged-secret", { "a.txt": "a\n" });
  await write(root, { ".env": "TOKEN=x\n", "a.txt": "b\n", "id_rsa": "KEY\n", "keys/it.key": "k\n", "config/old.txt": "o\n" });
  git(root, "add", ".env", "id_rsa");
  git(root, "add", "-N", "keys/it.key");
  const result = await commit(root, "Change a");
  assert.equal(result.kind, "done");
  assert.deepEqual(result.kind === "done" && result.left_out.sort(), [".env", "id_rsa", "keys/it.key"]);
  assert.deepEqual(git(root, "show", "--name-only", "--format=", "HEAD").trim().split("\n").sort(), ["a.txt", "config/old.txt"]);
  assert.equal(status(root), "A  .env\nA  id_rsa\n A keys/it.key");
  assert.deepEqual(await commit(root, "Only staged secrets"), { kind: "nothing", left_out: [".env", "id_rsa", "keys/it.key"] });
});

test("a staged secret file of a subfolder project is matched by its path inside the folder", options, async () => {
  const root = await repo_with("commit-staged-secret-sub", { "app/a.txt": "a\n" });
  await write(root, { "app/.env": "TOKEN=x\n", "app/a.txt": "b\n" });
  git(root, "add", "app/.env");
  const result = await commit(path.join(root, "app"), "Change app");
  assert.deepEqual(result.kind === "done" && result.left_out, [".env"]);
  assert.equal(git(root, "show", "--name-only", "--format=", "HEAD").trim(), "app/a.txt");
  assert.equal(status(root), "A  app/.env");
});

test("stopping the git session while a commit writes lets the commit finish and leaves no index.lock", options, async () => {
  const root = await repo_with("commit-stop", { "a.txt": "a\n" });
  const files: Record<string, string> = {};
  for (let index = 0; index < 500; index += 1) files[`many/f${index}.txt`] = `${index}\n`;
  await write(root, files);
  const access = await access_of(root);
  const controller = new AbortController();
  const lock = path.join(root, ".git", "index.lock");
  const watcher = watch(path.join(root, ".git"), (_event, name) => {
    if (name === "index.lock") controller.abort(new Error("the git session stopped"));
  });
  try {
    const result = await commit_changes({ ...access, signal: controller.signal }, await write_guard_of(root), "Add many");
    assert.equal(result.kind, "done");
  } finally {
    watcher.close();
  }
  assert.equal(controller.signal.aborted, true);
  assert.equal(existsSync(lock), false);
  assert.equal(status(root), "");
  assert.equal(git(root, "show", "--name-only", "--format=", "HEAD").trim().split("\n").length, 500);
});

test("nothing to commit comes back as nothing, also when only left-out files changed", options, async () => {
  const root = await repo_with("commit-nothing", { "a.txt": "a\n" });
  assert.deepEqual(await commit(root, "Nothing"), { kind: "nothing", left_out: [] });
  await write(root, { "id_rsa": "key\n" });
  assert.deepEqual(await commit(root, "Only the key"), { kind: "nothing", left_out: ["id_rsa"] });
  assert.equal(status(root), "?? id_rsa");
});

test("a running merge blocks the commit", options, async () => {
  const root = await repo_with("commit-merge", { "a.txt": "base\n" });
  git(root, "checkout", "-q", "-b", "side");
  await write(root, { "a.txt": "side\n" });
  git(root, "commit", "-q", "-am", "side");
  git(root, "checkout", "-q", "main");
  await write(root, { "a.txt": "main\n" });
  git(root, "commit", "-q", "-am", "main");
  assert.notEqual(git_status(root, "merge", "side"), 0);
  assert.deepEqual(await commit(root, "Merge"), { kind: "blocked", reason: "operation" });
});

test("conflicts without a running operation block the commit", options, async () => {
  const root = await repo_with("commit-conflict", { "a.txt": "base\n" });
  git(root, "checkout", "-q", "-b", "side");
  await write(root, { "a.txt": "side\n" });
  git(root, "commit", "-q", "-am", "side");
  git(root, "checkout", "-q", "main");
  await write(root, { "a.txt": "main\n" });
  git(root, "commit", "-q", "-am", "main");
  assert.notEqual(git_status(root, "merge", "side"), 0);
  for (const file of ["MERGE_HEAD", "MERGE_MSG", "MERGE_MODE"]) await fs.rm(path.join(root, ".git", file), { force: true });
  const result = await commit(root, "Pick");
  assert.deepEqual(result, { kind: "blocked", reason: "conflicts" });
});

test("a missing identity is reported and the new files go back out of the index", options, async () => {
  const root = await repo_with("commit-identity", { "a.txt": "a\n" });
  await write(root, { "a.txt": "b\n", "new.txt": "n\n" });
  const global = process.env.GIT_CONFIG_GLOBAL;
  await identity_config(false);
  try {
    assert.deepEqual(await commit(root, "No identity"), { kind: "identity" });
  } finally {
    process.env.GIT_CONFIG_GLOBAL = global;
  }
  assert.equal(status(root), "M a.txt\n?? new.txt");
});

test("the message is kept as written: paragraphs and a leading hash survive", options, async () => {
  const root = await repo_with("commit-message", { "a.txt": "a\n" });
  await write(root, { "a.txt": "b\n" });
  const message = "#42 Fix the login\n\nThe token expired after one hour.\n\n- second paragraph line";
  assert.equal((await commit(root, `${message}\n\n`)).kind, "done");
  assert.equal(git(root, "log", "-1", "--format=%B").trim(), message);
});

test("the first commit of a repository without commits works", options, async () => {
  const root = await scratch("commit-unborn");
  git(root, "init", "-q", "-b", "main");
  await write(root, { "a.txt": "a\n", "src/b.txt": "b\n" });
  const result = await commit(root, "First");
  assert.equal(result.kind, "done");
  assert.deepEqual(git(root, "show", "--name-only", "--format=", "HEAD").trim().split("\n").sort(), ["a.txt", "src/b.txt"]);
});

test("repository hooks stay off by default, with hooks on a failing pre-commit hook comes back with its output", options, async () => {
  const root = await repo_with("commit-hook", { "a.txt": "a\n" });
  await write(root, { ".git/hooks/pre-commit": "#!/bin/sh\necho 'lint says no' >&2\nexit 1\n", "a.txt": "b\n" });
  const guard = await write_guard_of(root);
  assert.equal(guard.hooks, true);
  assert.equal((await commit(root, "Hooks off")).kind, "done");
  await write(root, { "a.txt": "c\n", "n.txt": "n\n" });
  const result = await commit(root, "Hooks on", true);
  assert.equal(result.kind, "hook");
  assert.match(result.kind === "hook" ? result.output : "", /lint says no/);
  assert.equal(status(root), "M a.txt\n?? n.txt");
});

test("a repository-local filter or signing program blocks the commit", options, async () => {
  const root = await repo_with("commit-filter", { "a.txt": "a\n" });
  await write(root, { "a.txt": "b\n" });
  git(root, "config", "filter.lfs.clean", "git-lfs clean -- %f");
  git(root, "config", "gpg.program", "C:/tools/sign.exe");
  assert.deepEqual(await commit(root, "Filtered"), { kind: "programs", keys: ["filter.lfs", "gpg.program"] });
  assert.equal(status(root), "M a.txt");
});

test("commit output is classified by Git's own words", () => {
  assert.equal(classify_commit("Author identity unknown\n*** Please tell me who you are."), "identity");
  assert.equal(classify_commit("fatal: empty ident name (for <a@b>) not allowed"), "identity");
  assert.equal(classify_commit("nothing added to commit but untracked files present"), "nothing");
  assert.equal(classify_commit("no changes added to commit (use \"git add\")"), "nothing");
  assert.equal(classify_commit("fatal: Unable to create 'C:/r/.git/index.lock': File exists."), "locked");
  assert.equal(classify_commit("error: something else"), null);
});
