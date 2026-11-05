import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { read_pair } from "../electron/turn-diff/git-read.ts";
import { parse_filtered, parse_gitlinks } from "../electron/turn-diff/git-snapshot.ts";
import { git, git_status, marker, repo_with, scratch, skip_without_git, write } from "./git-kit.ts";
import { common_dir_of, git_target, signal, snap, store_for, tree_files } from "./turn-diff-kit.ts";

const options = { skip: skip_without_git };

const filter_command = (file: string) => `sh -c 'echo ran >> "${file}"; cat'`;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const head_of = (root: string) => git(root, "rev-parse", "HEAD").trim();

test("a registered submodule's own clean filter never runs during a snapshot", options, async () => {
  const lib = await repo_with("tde-lib", { "lib.dat": "l\n", ".gitattributes": "*.dat filter=subf\n" });
  const root = await repo_with("tde-super", { "a.txt": "a\n" });
  git(root, "submodule", "add", "-q", lib.replace(/\\/g, "/"), "lib");
  git(root, "commit", "-q", "-m", "sub");
  const sub = path.join(root, "lib");
  const ran = await marker();
  git(sub, "config", "filter.subf.clean", filter_command(ran.file));
  await pause(1100);
  await write(sub, { "lib.dat": "l2\n" });
  const paths = await store_for();
  const first = await snap(root, paths);
  assert.equal(await ran.ran(), false);
  assert.equal(tree_files(root, paths, common_dir_of(root), first.point.tree)["lib"], `commit ${head_of(sub)}`);
  const second = await snap(root, paths, first.index_repo);
  assert.equal(await ran.ran(), false);
  assert.equal(second.point.tree, first.point.tree);
});

test("a nested repository's own clean filter never runs, also once it is a gitlink in the chat index of a subfolder chat", options, async () => {
  const root = await repo_with("tde-nest", { "web/a.txt": "a\n" });
  const web = path.join(root, "web");
  const nested = path.join(web, "nested");
  await write(nested, { "n.dat": "n\n", ".gitattributes": "*.dat filter=nestf\n" });
  git(nested, "init", "-q", "-b", "main");
  git(nested, "add", "-A");
  git(nested, "commit", "-q", "-m", "n");
  const ran = await marker();
  git(nested, "config", "filter.nestf.clean", filter_command(ran.file));
  const paths = await store_for();
  const first = await snap(web, paths);
  const second = await snap(web, paths, first.index_repo);
  await pause(1100);
  await write(nested, { "n.dat": "m\n" });
  const third = await snap(web, paths, second.index_repo);
  assert.equal(await ran.ran(), false);
  assert.equal(tree_files(root, paths, common_dir_of(root), third.point.tree)["web/nested"], `commit ${head_of(nested)}`);
  git(nested, "commit", "-q", "-am", "moved");
  await fs.rm(ran.file);
  const fourth = await snap(web, paths, third.index_repo);
  assert.equal(tree_files(root, paths, common_dir_of(root), fourth.point.tree)["web/nested"], `commit ${head_of(nested)}`);
  assert.equal(await ran.ran(), false);
});

test("an uninitialized submodule stays in the snapshot as the gitlink the index had", options, async () => {
  const lib = await repo_with("tde-uninit-lib", { "l.txt": "l\n" });
  const origin = await repo_with("tde-uninit-origin", { "a.txt": "a\n" });
  git(origin, "submodule", "add", "-q", lib.replace(/\\/g, "/"), "lib");
  git(origin, "commit", "-q", "-m", "sub");
  const root = path.join(await scratch("tde-uninit"), "clone");
  git(path.dirname(root), "clone", "-q", origin.replace(/\\/g, "/"), root);
  const paths = await store_for();
  const taken = await snap(root, paths);
  assert.equal(tree_files(root, paths, common_dir_of(root), taken.point.tree)["lib"], `commit ${head_of(lib)}`);
});

test("a file with a clean filter shows only the lines the turn changed, not the filter's rewrite", options, async () => {
  const root = await repo_with("tde-filtered", { "a.txt": "a\n" });
  git(root, "config", "filter.strip.clean", "sed -e 's/^output: .*/output: (stripped)/'");
  git(root, "config", "filter.strip.smudge", "cat");
  await write(root, { ".gitattributes": "*.nb filter=strip\n", "note.nb": "cell: 1\noutput: 42\ncell: 2\noutput: 43\n" });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "notebook");
  await pause(1500);
  git(root, "status", "--porcelain");
  await pause(1200);
  assert.equal(git(root, "show", ":note.nb"), "cell: 1\noutput: (stripped)\ncell: 2\noutput: (stripped)\n");
  const paths = await store_for();
  const first = await snap(root, paths);
  await write(root, { "note.nb": "cell: 1\noutput: 42\ncell: 2 edited\noutput: 43\n" });
  const second = await snap(root, paths, first.index_repo);
  const target = await git_target(root);
  const summary = await read_pair(target, paths, { prefix: "", base: first.point.tree, end: second.point.tree }, signal);
  assert.deepEqual(summary.entries.map((entry) => [entry.path, entry.added, entry.removed]), [["note.nb", 1, 1]]);
  assert.equal(git(root, "show", ":note.nb"), "cell: 1\noutput: (stripped)\ncell: 2\noutput: (stripped)\n");
});

test("a chat index naming a blob the repository's gc pruned is seeded again and later snapshots work", options, async () => {
  const root = await repo_with("tde-pruned", { "a.txt": "a\n", "f.txt": "committed\n" });
  await write(root, { "f.txt": "staged then unstaged\n" });
  git(root, "add", "f.txt");
  git(root, "reset", "-q", "f.txt");
  await pause(1100);
  const paths = await store_for();
  const first = await snap(root, paths);
  git(root, "gc", "-q", "--prune=now");
  await write(root, { "a.txt": "a2\n" });
  const second = await snap(root, paths, first.index_repo);
  assert.deepEqual(tree_files(root, paths, common_dir_of(root), second.point.tree), { "a.txt": "a2\n", "f.txt": "staged then unstaged\n" });
  await write(root, { "a.txt": "a3\n" });
  const third = await snap(root, paths, second.index_repo);
  assert.deepEqual(tree_files(root, paths, common_dir_of(root), third.point.tree), { "a.txt": "a3\n", "f.txt": "staged then unstaged\n" });
});

test("an untracked file outside a sparse checkout cone does not fail the snapshot", options, async () => {
  const root = await repo_with("tde-sparse", { "top.txt": "t\n", "web/a.txt": "a\n", "api/b.txt": "b\n" });
  git(root, "sparse-checkout", "set", "--cone", "web");
  await assert.rejects(fs.access(path.join(root, "api", "b.txt")));
  await write(root, { "api/new.txt": "n\n", "web/a.txt": "a2\n" });
  assert.notEqual(git_status(root, "add", "-A", "--dry-run", "--", "."), 0);
  const paths = await store_for();
  const taken = await snap(root, paths);
  assert.deepEqual(tree_files(root, paths, common_dir_of(root), taken.point.tree), { "api/b.txt": "b\n", "api/new.txt": "n\n", "top.txt": "t\n", "web/a.txt": "a2\n" });
});

test("parse_filtered keeps paths with a named filter and parse_gitlinks keeps gitlink paths", () => {
  assert.deepEqual(parse_filtered(["a.nb", "filter", "strip", "b.txt", "filter", "unspecified", "c.bin", "filter", "lfs", "d", "filter", "unset", "e", "filter", "set", ""].join("\0")), ["a.nb", "c.bin"]);
  assert.deepEqual(parse_gitlinks(["100644 aaa 0\ta.txt", "160000 bbb 0\tlib", "160000 ccc 0\tsub dir/x", ""].join("\0")), ["lib", "sub dir/x"]);
});
