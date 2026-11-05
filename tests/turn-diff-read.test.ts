import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import type { DiffEntry } from "../shared/turn-diff.ts";
import { read_pair, read_pair_file } from "../electron/turn-diff/git-read.ts";
import { snapshot_env } from "../electron/turn-diff/git-snapshot.ts";
import type { ChatPaths } from "../electron/turn-diff/paths.ts";
import { git, repo_with, skip_without_git, tool, write } from "./git-kit.ts";
import { common_dir_of, git_target, signal, snap, store_for } from "./turn-diff-kit.ts";

const options = { skip: skip_without_git };

const pick = (entries: DiffEntry[], file: string): DiffEntry => {
  const entry = entries.find((candidate) => candidate.path === file);
  if (!entry) throw new Error(`${file} is not in ${JSON.stringify(entries.map((candidate) => candidate.path))}`);
  return entry;
};

const pair_of = async (root: string, paths: ChatPaths, change: () => Promise<void>, prefix = "") => {
  const first = await snap(root, paths);
  await change();
  const second = await snap(root, paths, first.index_repo);
  return { prefix, base: first.point.tree, end: second.point.tree };
};

test("a summary lists added, modified, deleted, renamed and binary files with their counts", options, async () => {
  const root = await repo_with("tdr-kinds", { "mod.txt": "a\nb\nc\n", "gone.txt": "bye\n", "old name.txt": "same content\nline two\n" });
  const paths = await store_for();
  const pair = await pair_of(root, paths, async () => {
    await write(root, { "mod.txt": "a\nB\nc\nd\n", "new.txt": "n1\nn2\n" });
    await fs.rm(path.join(root, "gone.txt"));
    await fs.rename(path.join(root, "old name.txt"), path.join(root, "new name.txt"));
    await fs.writeFile(path.join(root, "blob.bin"), Buffer.from([0, 1, 2, 0, 255]));
  });
  const target = await git_target(root);
  const summary = await read_pair(target, paths, pair, signal);
  assert.equal(summary.renames_skipped, false);
  assert.deepEqual(summary.entries.map((entry) => entry.path), ["blob.bin", "gone.txt", "mod.txt", "new name.txt", "new.txt"]);
  assert.deepEqual(pick(summary.entries, "mod.txt"), { path: "mod.txt", orig_path: null, status: "modified", added: 2, removed: 1, binary: false, commits: null });
  assert.deepEqual(pick(summary.entries, "new.txt"), { path: "new.txt", orig_path: null, status: "added", added: 2, removed: 0, binary: false, commits: null });
  assert.deepEqual(pick(summary.entries, "gone.txt"), { path: "gone.txt", orig_path: null, status: "deleted", added: 0, removed: 1, binary: false, commits: null });
  assert.deepEqual(pick(summary.entries, "new name.txt"), { path: "new name.txt", orig_path: "old name.txt", status: "renamed", added: 0, removed: 0, binary: false, commits: null });
  assert.deepEqual(pick(summary.entries, "blob.bin"), { path: "blob.bin", orig_path: null, status: "added", added: null, removed: null, binary: true, commits: null });
  const text = await read_pair_file(target, paths, pair, pick(summary.entries, "mod.txt"), signal);
  assert.equal(text.kind, "text");
  assert.deepEqual(text.kind === "text" ? text.lines.filter((line) => line.kind !== "context").map((line) => `${line.kind} ${line.text}`) : [], ["remove b", "add B", "add d"]);
  assert.deepEqual(await read_pair_file(target, paths, pair, pick(summary.entries, "blob.bin"), signal), { kind: "binary" });
  assert.deepEqual(await read_pair_file(target, paths, pair, pick(summary.entries, "new name.txt"), signal), { kind: "unchanged" });
});

test("a blob that became a symlink is a type change", options, async () => {
  const root = await repo_with("tdr-type", { "link.txt": "target.txt\n", "target.txt": "t\n" });
  const paths = await store_for();
  const first = await snap(root, paths);
  const env = { ...process.env, ...snapshot_env(paths, common_dir_of(root), false) };
  const run = (args: string[], input?: string) => execFileSync(tool().exe, args, { cwd: root, env, input }).toString("utf8").trim();
  const listed = run(["ls-tree", first.point.tree]);
  const link_blob = run(["hash-object", "-w", "--stdin"], "target.txt");
  const swapped = listed.replace(/^100644 blob [0-9a-f]+\tlink\.txt$/m, `120000 blob ${link_blob}\tlink.txt`);
  const end = run(["mktree"], `${swapped}\n`);
  const summary = await read_pair(await git_target(root), paths, { prefix: "", base: first.point.tree, end }, signal);
  assert.deepEqual(summary.entries.map((entry) => [entry.path, entry.status]), [["link.txt", "type_changed"]]);
});

test("a nested repository and a submodule are rows with their commit change", options, async () => {
  const library = await repo_with("tdr-lib", { "lib.txt": "l\n" });
  const root = await repo_with("tdr-host", { "a.txt": "a\n" });
  git(root, "submodule", "add", "-q", library.replaceAll("\\", "/"), "sub");
  git(root, "commit", "-q", "-m", "add sub");
  const nested = path.join(root, "nested");
  await fs.mkdir(nested);
  git(nested, "init", "-q", "-b", "main");
  await write(nested, { "n.txt": "n\n" });
  git(nested, "add", "-A");
  git(nested, "commit", "-q", "-m", "n1");
  const paths = await store_for();
  const sub = path.join(root, "sub");
  const before = { nested: git(nested, "rev-parse", "HEAD").trim(), sub: git(sub, "rev-parse", "HEAD").trim() };
  const pair = await pair_of(root, paths, async () => {
    await write(nested, { "n.txt": "n2\n" });
    git(nested, "commit", "-q", "-am", "n2");
    await write(sub, { "lib.txt": "l2\n" });
    git(sub, "commit", "-q", "-am", "l2");
  });
  const summary = await read_pair(await git_target(root), paths, pair, signal);
  assert.deepEqual(pick(summary.entries, "nested"), {
    path: "nested",
    orig_path: null,
    status: "submodule",
    added: null,
    removed: null,
    binary: false,
    commits: { from: before.nested, to: git(nested, "rev-parse", "HEAD").trim() },
  });
  assert.deepEqual(pick(summary.entries, "sub").commits, { from: before.sub, to: git(sub, "rev-parse", "HEAD").trim() });
  assert.deepEqual(summary.entries.map((entry) => entry.path), ["nested", "sub"]);
});

test("a subfolder chat reads paths relative to its folder and leaves out changes beside it", options, async () => {
  const root = await repo_with("tdr-relative", { "web/a.txt": "a\n", "api/b.txt": "b\n" });
  const web = path.join(root, "web");
  const paths = await store_for();
  const pair = await pair_of(web, paths, async () => {
    await write(root, { "web/a.txt": "a2\n", "web/deep/c.txt": "c\n", "api/b.txt": "b2\n" });
  }, "web/");
  const target = await git_target(web);
  const summary = await read_pair(target, paths, pair, signal);
  assert.deepEqual(summary.entries.map((entry) => entry.path), ["a.txt", "deep/c.txt"]);
  const diff = await read_pair_file(target, paths, pair, pick(summary.entries, "deep/c.txt"), signal);
  assert.deepEqual(diff.kind === "text" ? diff.lines.map((line) => line.text) : [], ["c"]);
});

test("a file whose borrowed blob is gone from the repository reads as object_missing", options, async () => {
  const root = await repo_with("tdr-missing", { "a.txt": "original\n" });
  const paths = await store_for();
  const pair = await pair_of(root, paths, async () => {
    await write(root, { "a.txt": "changed\n" });
  });
  const target = await git_target(root);
  const entry = pick((await read_pair(target, paths, pair, signal)).entries, "a.txt");
  const blob = git(root, "rev-parse", "HEAD:a.txt").trim();
  const loose = path.join(root, ".git", "objects", blob.slice(0, 2), blob.slice(2));
  await fs.chmod(loose, 0o666);
  await fs.rm(loose);
  assert.deepEqual(await read_pair_file(target, paths, pair, entry, signal), { kind: "object_missing" });
});

test("renames past diff.renameLimit are reported as skipped", options, async () => {
  const files: Record<string, string> = {};
  for (let index = 0; index < 4; index += 1) files[`f${index}.txt`] = `${[...Array(20).keys()].map((line) => `file ${index} line ${line}`).join("\n")}\n`;
  const root = await repo_with("tdr-limit", files);
  git(root, "config", "diff.renameLimit", "1");
  const paths = await store_for();
  const pair = await pair_of(root, paths, async () => {
    for (let index = 0; index < 4; index += 1) {
      await fs.rm(path.join(root, `f${index}.txt`));
      await write(root, { [`moved/g${index}.txt`]: `${files[`f${index}.txt`]}extra line\n` });
    }
  });
  const summary = await read_pair(await git_target(root), paths, pair, signal);
  assert.equal(summary.renames_skipped, true);
  assert.equal(summary.entries.filter((entry) => entry.status === "renamed").length, 0);
  assert.equal(summary.entries.length, 8);
});

test("a tree pair that git can no longer read fails with git's line", options, async () => {
  const root = await repo_with("tdr-gone", { "a.txt": "a\n" });
  const paths = await store_for();
  const pair = await pair_of(root, paths, async () => {
    await write(root, { "a.txt": "b\n" });
  });
  const target = await git_target(root);
  await fs.rm(paths.objects, { recursive: true, force: true });
  await assert.rejects(read_pair(target, paths, pair, signal), (error: Error & { git_line?: string }) => /^fatal:|^error:/.test(error.git_line ?? ""));
});
