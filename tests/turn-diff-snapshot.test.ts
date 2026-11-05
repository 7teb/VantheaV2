import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { parse_unreadable } from "../electron/turn-diff/git-snapshot.ts";
import { resolve_target } from "../electron/turn-diff/git-target.ts";
import { git, git_status, marker, posix, repo_with, scratch, skip_without_git, tool, write } from "./git-kit.ts";
import { common_dir_of, object_count, signal, snap, store_for, tree_files } from "./turn-diff-kit.ts";

const options = { skip: skip_without_git };

const filter_command = (file: string) => `sh -c 'echo ran >> "${file}"; cat'`;

const repo_state = async (root: string) => ({
  head: git(root, "rev-parse", "HEAD"),
  refs: git(root, "for-each-ref"),
  index: (await fs.readFile(path.join(root, ".git", "index"))).toString("base64"),
  stash: git(root, "stash", "list"),
  status: git(root, "--no-optional-locks", "status", "--porcelain=v1", "-uall"),
  objects: await object_count(path.join(root, ".git", "objects")),
  files: {
    a: await fs.readFile(path.join(root, "a.txt"), "utf8"),
    b: await fs.readFile(path.join(root, "b.txt"), "utf8"),
  },
});

test("a snapshot leaves HEAD, refs, the index bytes, the stash, the working tree and the object count of the repository unchanged", options, async () => {
  const root = await repo_with("td-untouched", { "a.txt": "a\n", "b.txt": "b\n" });
  await write(root, { "a.txt": "a2\n", "b.txt": "b\n", "new.txt": "fresh\n" });
  git(root, "stash", "push", "-q", "--", "a.txt");
  await write(root, { "a.txt": "a3\n" });
  const before = await repo_state(root);
  const paths = await store_for();
  const taken = await snap(root, paths);
  assert.match(taken.point.tree, /^[0-9a-f]{40}$/);
  assert.deepEqual(await repo_state(root), before);
  assert.ok((await object_count(paths.objects)) > 0);
});

test("a snapshot captures a file changed by a child process, an untracked file and a deletion", options, async () => {
  const root = await repo_with("td-capture", { "a.txt": "a\n", "gone.txt": "bye\n", "keep.txt": "keep\n" });
  const paths = await store_for();
  const first = await snap(root, paths);
  execFileSync(process.execPath, ["-e", "require('fs').writeFileSync('a.txt', 'changed by a child\\n')"], { cwd: root });
  await fs.rm(path.join(root, "gone.txt"));
  await write(root, { "untracked.txt": "u\n" });
  const second = await snap(root, paths, first.index_repo);
  const common = common_dir_of(root);
  assert.deepEqual(tree_files(root, paths, common, first.point.tree), { "a.txt": "a\n", "gone.txt": "bye\n", "keep.txt": "keep\n" });
  assert.deepEqual(tree_files(root, paths, common, second.point.tree), { "a.txt": "changed by a child\n", "keep.txt": "keep\n", "untracked.txt": "u\n" });
});

test("a chat in a subfolder only updates its prefix, files outside stay as the index had them", options, async () => {
  const root = await repo_with("td-prefix", { "web/a.txt": "a\n", "api/b.txt": "b\n" });
  const web = path.join(root, "web");
  const paths = await store_for();
  const first = await snap(web, paths);
  await write(root, { "web/a.txt": "a2\n", "web/c.txt": "c\n", "api/b.txt": "b2\n", "api/new.txt": "n\n" });
  const second = await snap(web, paths, first.index_repo);
  const files = tree_files(root, paths, common_dir_of(root), second.point.tree);
  assert.deepEqual(files, { "api/b.txt": "b\n", "web/a.txt": "a2\n", "web/c.txt": "c\n" });
});

test("an unborn repository is snapshotted", options, async () => {
  const root = await scratch("td-unborn");
  git(root, "init", "-q", "-b", "main");
  await write(root, { "a.txt": "a\n" });
  const paths = await store_for();
  const taken = await snap(root, paths);
  assert.deepEqual(tree_files(root, paths, common_dir_of(root), taken.point.tree), { "a.txt": "a\n" });
  assert.equal(git_status(root, "rev-parse", "-q", "--verify", "HEAD"), 1);
});

test("clean filters from the repository and from the global config never run during a snapshot", options, async () => {
  const root = await repo_with("td-filter", { "a.txt": "a\n" });
  await write(root, { ".gitattributes": "*.txt filter=mark\n*.dat filter=globalmark\n", "a.txt": "a2\n", "b.dat": "b\n" });
  const local = await marker();
  const global = await marker();
  git(root, "config", "filter.mark.clean", filter_command(local.file));
  git(root, "config", "filter.mark.required", "true");
  const global_file = path.join(await scratch("td-global"), "gitconfig");
  git(root, "config", "--file", global_file, "filter.globalmark.clean", filter_command(global.file));
  git(root, "config", "--file", global_file, "filter.globalmark.required", "true");
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = posix(global_file);
  try {
    const paths = await store_for();
    const taken = await snap(root, paths);
    assert.equal(await local.ran(), false);
    assert.equal(await global.ran(), false);
    assert.equal(tree_files(root, paths, common_dir_of(root), taken.point.tree)["a.txt"], "a2\n");
    execFileSync(tool().exe, ["add", "-A"], { cwd: root, env: process.env });
    assert.equal(await local.ran(), true);
    assert.equal(await global.ran(), true);
  } finally {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
  }
});

test("a stale index.lock in the chat store is removed before the snapshot", options, async () => {
  const root = await repo_with("td-lock", { "a.txt": "a\n" });
  const paths = await store_for();
  const first = await snap(root, paths);
  await fs.writeFile(paths.index_lock, "");
  await write(root, { "a.txt": "a2\n" });
  const second = await snap(root, paths, first.index_repo);
  assert.notEqual(second.point.tree, first.point.tree);
  await assert.rejects(fs.access(paths.index_lock));
});

test("a second snapshot of an unchanged folder returns the same tree", options, async () => {
  const root = await repo_with("td-same", { "a.txt": "a\n" });
  await write(root, { "b.txt": "b\n" });
  const paths = await store_for();
  const first = await snap(root, paths);
  const second = await snap(root, paths, first.index_repo);
  assert.equal(second.point.tree, first.point.tree);
});

test("a conflicted user index outside the prefix falls back to the HEAD tree", options, async () => {
  const root = await repo_with("td-conflict", { "web/a.txt": "a\n", "api/b.txt": "base\n" });
  git(root, "checkout", "-q", "-b", "other");
  await write(root, { "api/b.txt": "other\n" });
  git(root, "commit", "-q", "-am", "other");
  git(root, "checkout", "-q", "main");
  await write(root, { "api/b.txt": "main\n" });
  git(root, "commit", "-q", "-am", "main");
  assert.notEqual(git_status(root, "merge", "other"), 0);
  assert.notEqual(git(root, "ls-files", "-u"), "");
  const paths = await store_for();
  await write(root, { "web/a.txt": "a2\n" });
  const taken = await snap(path.join(root, "web"), paths);
  const files = tree_files(root, paths, common_dir_of(root), taken.point.tree);
  assert.equal(files["web/a.txt"], "a2\n");
  assert.equal(files["api/b.txt"], "main\n");
  assert.notEqual(git(root, "ls-files", "-u"), "");
});

test("a split user index is copied into a self-contained chat index that survives the shared file going away", options, async () => {
  const root = await repo_with("td-split", { "a.txt": "a\n", "b.txt": "b\n" });
  git(root, "update-index", "--split-index");
  const shared = async () => (await fs.readdir(path.join(root, ".git"))).filter((name) => name.startsWith("sharedindex."));
  const before = await shared();
  assert.equal(before.length, 1);
  await write(root, { "a.txt": "a2\n" });
  const paths = await store_for();
  const first = await snap(root, paths);
  assert.deepEqual(await shared(), before);
  assert.deepEqual(tree_files(root, paths, common_dir_of(root), first.point.tree), { "a.txt": "a2\n", "b.txt": "b\n" });
  for (const name of before) await fs.rm(path.join(root, ".git", name), { force: true });
  await write(root, { "b.txt": "b2\n" });
  const second = await snap(root, paths, first.index_repo);
  assert.deepEqual(tree_files(root, paths, common_dir_of(root), second.point.tree), { "a.txt": "a2\n", "b.txt": "b2\n" });
});

test("a worktree folder snapshots its own files", options, async () => {
  const root = await repo_with("td-main", { "a.txt": "main\n" });
  const tree_dir = path.join(await scratch("td-worktree"), "wt");
  git(root, "worktree", "add", "-q", "-b", "side", tree_dir);
  await write(tree_dir, { "a.txt": "side\n", "s.txt": "s\n" });
  await write(root, { "a.txt": "main changed\n" });
  const target = await resolve_target(tree_dir, signal);
  assert.equal(target.kind, "git");
  const paths = await store_for();
  const taken = await snap(tree_dir, paths);
  assert.deepEqual(tree_files(tree_dir, paths, common_dir_of(tree_dir), taken.point.tree), { "a.txt": "side\n", "s.txt": "s\n" });
});

test("a folder that is not a repository and an ignored folder resolve to recorded mode", options, async () => {
  const plain = await scratch("td-plain");
  assert.deepEqual(await resolve_target(plain, signal), { kind: "recorded", reason: "not_repo", detail: plain });
  const root = await repo_with("td-ignored", { ".gitignore": "build/\n", "a.txt": "a\n" });
  await write(root, { "build/out.txt": "x\n" });
  const ignored = await resolve_target(path.join(root, "build"), signal);
  assert.equal(ignored.kind, "recorded");
  assert.equal(ignored.kind === "recorded" ? ignored.reason : "", "ignored_folder");
});

test("an alternate object folder with a semicolon in its path is quoted for git", options, async () => {
  const parent = await scratch("td-semi");
  const root = path.join(parent, "a;b");
  await fs.mkdir(root);
  git(root, "init", "-q", "-b", "main");
  await write(root, { "a.txt": "a\n" });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  await write(root, { "a.txt": "a2\n" });
  const paths = await store_for();
  const taken = await snap(root, paths);
  assert.deepEqual(tree_files(root, paths, common_dir_of(root), taken.point.tree), { "a.txt": "a2\n" });
});

test("parse_unreadable reads both error lines git prints for a locked file and strips the prefix", () => {
  const stderr = ['error: open("web/locked.txt"): Permission denied', "error: unable to index file 'web/locked.txt'", "fatal: adding files failed", 'error: open("web/sub/other.bin"): Invalid argument'].join("\n");
  assert.deepEqual(parse_unreadable(stderr, "web/"), ["locked.txt", "sub/other.bin"]);
  assert.deepEqual(parse_unreadable("error: unable to index file 'top.txt'\r\n", ""), ["top.txt"]);
  assert.deepEqual(parse_unreadable("warning: in the working copy of 'a.txt', LF will be replaced by CRLF\n", ""), []);
});
