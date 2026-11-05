import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, test } from "node:test";
import type { GitFileDiff } from "../shared/git-view.ts";
import type { DiffLine } from "../shared/tool-view.ts";
import { create_commit_reader } from "../electron/git/commit.ts";
import { read_file_diff, read_line_counts } from "../electron/git/diff.ts";
import { partial_clone_git, version_at_least } from "../electron/git/locate.ts";
import { default_readers } from "../electron/git/readers.ts";
import { create_git_session, type GitSession } from "../electron/git/session.ts";
import { git, marker, posix, quiet_fetcher, quiet_window, real_git, repo_with, scratch, skip_without_git, touch_future, write } from "./git-kit.ts";

const options = { skip: skip_without_git };

const partial_options = { skip: real_git && version_at_least(real_git.numbers, partial_clone_git) ? false : "Git 2.45 or newer is needed to read a partial clone" };

const sessions: GitSession[] = [];

afterEach(() => {
  for (const session of sessions.splice(0)) session.stop();
});

const open_session = (root: string): Promise<GitSession> =>
  new Promise((resolve, reject) => {
    const session = create_git_session(
      { path: root, name: path.basename(root), kind: "project" },
      {
        readers: default_readers,
        publish: (_root, view) => {
          if (view.kind === "repo") resolve(session);
          else if (view.kind !== "loading") reject(new Error(`expected a repository view for ${root}, got ${JSON.stringify(view)}`));
        },
        window: quiet_window,
        fetcher: quiet_fetcher,
      },
    );
    sessions.push(session);
  });

const diff_of = async (root: string, file: string): Promise<GitFileDiff> => read_file_diff(await (await open_session(root)).read_access(), file);

const text_lines = (diff: GitFileDiff): DiffLine[] => {
  if (diff.kind !== "text") throw new Error(`expected a text diff, got ${diff.kind}`);
  return diff.lines;
};

const index_time = async (root: string): Promise<number> => (await fs.stat(path.join(root, ".git", "index"))).mtimeMs;

const changed_rows = (diff: GitFileDiff) => text_lines(diff).filter((line) => line.kind === "add" || line.kind === "remove").map((line) => `${line.kind} ${line.text}`);

test("a modified file gives its hunks against HEAD and its line counts", options, async () => {
  const root = await repo_with("diff-mod", { "a.txt": "one\ntwo\nthree\n" });
  await write(root, { "a.txt": "one\nTWO\nthree\n" });
  const access = await (await open_session(root)).read_access();
  assert.deepEqual(text_lines(await read_file_diff(access, "a.txt")), [
    { kind: "context", text: "one", old_line: 1, new_line: 1 },
    { kind: "remove", text: "two", old_line: 2, new_line: null },
    { kind: "add", text: "TWO", old_line: null, new_line: 2 },
    { kind: "context", text: "three", old_line: 3, new_line: 3 },
  ]);
  assert.deepEqual(await read_line_counts(access), [{ path: "a.txt", added: 1, removed: 1 }]);
});

test("a renamed file is diffed with both paths, asked for by the new or the old name", options, async () => {
  const root = await repo_with("diff-rename", { "old name.txt": "a\nb\nc\nd\ne\n" });
  git(root, "mv", "old name.txt", "new name.txt");
  await write(root, { "new name.txt": "a\nb\nc\nd\nE\n" });
  const access = await (await open_session(root)).read_access();
  const by_new = await read_file_diff(access, "new name.txt");
  assert.deepEqual(changed_rows(by_new), ["remove e", "add E"]);
  assert.deepEqual(await read_file_diff(access, "old name.txt"), by_new);
  assert.deepEqual(await read_line_counts(access), [{ path: "new name.txt", added: 1, removed: 1 }]);
});

test("a file deleted from the work tree still shows all its removed lines", options, async () => {
  const root = await repo_with("diff-deleted", { "gone.txt": "x\ny\n", "keep.txt": "k\n" });
  await fs.rm(path.join(root, "gone.txt"));
  const diff = await diff_of(root, "gone.txt");
  assert.deepEqual(changed_rows(diff), ["remove x", "remove y"]);
});

test("a file whose only change is its line endings under core.autocrlf is reported as such", options, async () => {
  const root = await scratch("diff-eol");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "core.autocrlf", "true");
  await write(root, { "lf.txt": "a\nb\n" });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  await write(root, { "lf.txt": "a\r\nb\r\n" });
  const access = await (await open_session(root)).read_access();
  assert.equal(access.view.entries.find((entry) => entry.path === "lf.txt")?.status, "modified");
  const before = await index_time(root);
  assert.deepEqual(await read_file_diff(access, "lf.txt"), { kind: "eol_only" });
  assert.equal(await index_time(root), before);
  assert.deepEqual(await read_line_counts(access), []);
  assert.equal(await index_time(root), before);
});

test("counts and diffs never rewrite the index, also when a tracked file is only touched", options, async () => {
  const root = await repo_with("diff-index", { "a.txt": "a\n", "same.txt": "s\n" });
  await write(root, { "a.txt": "A\n" });
  const access = await (await open_session(root)).read_access();
  await touch_future(path.join(root, "same.txt"));
  const before = await index_time(root);
  assert.deepEqual(await read_line_counts(access), [{ path: "a.txt", added: 1, removed: 1 }]);
  assert.equal(await index_time(root), before);
  assert.deepEqual(changed_rows(await read_file_diff(access, "a.txt")), ["remove a", "add A"]);
  assert.equal(await index_time(root), before);
});

test("a file removed from the index but kept on disk is diffed as deleted, not refused as untracked", options, async () => {
  const root = await repo_with("diff-untracked-copy", { "a.txt": "x\ny\n", "keep.txt": "k\n" });
  git(root, "rm", "-q", "--cached", "a.txt");
  const access = await (await open_session(root)).read_access();
  const statuses = access.view.entries.filter((entry) => entry.path === "a.txt").map((entry) => entry.status);
  assert.deepEqual([...statuses].sort(), ["deleted", "untracked"]);
  assert.deepEqual(changed_rows(await read_file_diff(access, "a.txt")), ["remove x", "remove y"]);
  assert.deepEqual(await read_line_counts(access), [{ path: "a.txt", added: 0, removed: 2 }]);
});

test("a file git treats as binary has no line diff and no counts", options, async () => {
  const root = await repo_with("diff-binary", { "b.dat": "a\u0000b" });
  await write(root, { "b.dat": "a\u0000c" });
  const access = await (await open_session(root)).read_access();
  assert.deepEqual(await read_file_diff(access, "b.dat"), { kind: "binary" });
  assert.deepEqual(await read_line_counts(access), [{ path: "b.dat", added: null, removed: null }]);
});

test("paths go to git as literal pathspecs, glob characters match only the file itself", options, async () => {
  const root = await repo_with("diff-literal", { "[ab].txt": "glob\n", "a.txt": "plain\n" });
  await write(root, { "[ab].txt": "GLOB\n", "a.txt": "PLAIN\n" });
  const access = await (await open_session(root)).read_access();
  const before = process.env.GIT_GLOB_PATHSPECS;
  process.env.GIT_GLOB_PATHSPECS = "1";
  try {
    assert.deepEqual(changed_rows(await read_file_diff(access, "[ab].txt")), ["remove glob", "add GLOB"]);
  } finally {
    if (before === undefined) delete process.env.GIT_GLOB_PATHSPECS;
    else process.env.GIT_GLOB_PATHSPECS = before;
  }
});

test("line counts work in a repository without commits", options, async () => {
  const root = await scratch("diff-unborn");
  git(root, "init", "-q", "-b", "main");
  await write(root, { "first.txt": "1\n2\n3\n", "loose.txt": "u\n" });
  git(root, "add", "first.txt");
  const access = await (await open_session(root)).read_access();
  assert.equal(access.view.head, null);
  assert.deepEqual(await read_line_counts(access), [{ path: "first.txt", added: 3, removed: 0 }]);
  await assert.rejects(read_file_diff(access, "first.txt"), /has no commits yet/);
});

test("in a subfolder project counts and diffs cover only the subfolder, with paths relative to it", options, async () => {
  const repo = await repo_with("diff-sub", { "top.txt": "t\n", "sub/inner.txt": "i\n" });
  await write(repo, { "top.txt": "T\n", "sub/inner.txt": "I\n" });
  const access = await (await open_session(path.join(repo, "sub"))).read_access();
  assert.deepEqual(await read_line_counts(access), [{ path: "inner.txt", added: 1, removed: 1 }]);
  assert.deepEqual(changed_rows(await read_file_diff(access, "inner.txt")), ["remove i", "add I"]);
  await assert.rejects(read_file_diff(access, "../top.txt"), /is not a changed file/);
});

test("only paths of changed tracked files are diffed", options, async () => {
  const root = await repo_with("diff-members", { "a.txt": "a\n", "same.txt": "s\n" });
  await write(root, { "a.txt": "A\n", "new.txt": "n\n" });
  const access = await (await open_session(root)).read_access();
  await assert.rejects(read_file_diff(access, "same.txt"), /is not a changed file/);
  await assert.rejects(read_file_diff(access, "new.txt"), /is not tracked by git/);
  await assert.rejects(read_file_diff(access, "A.txt"), /is not a changed file/);
});

test("a filter the repository configures after the view was read still never runs for a diff", options, async () => {
  const root = await repo_with("diff-guard", { ".gitattributes": "*.txt filter=mark\n", "a.txt": "a\n" });
  await write(root, { "a.txt": "b\n" });
  const session = await open_session(root);
  const mark = await marker();
  git(root, "config", "filter.mark.clean", `sh -c 'echo ran >> "${mark.file}"; cat'`);
  assert.deepEqual(changed_rows(await read_file_diff(await session.read_access(), "a.txt")), ["remove a", "add b"]);
  assert.equal(await mark.ran(), false);
  git(root, "diff", "HEAD");
  assert.equal(await mark.ran(), true);
});

test("a submodule's own diff driver never runs for its diff, also when the superproject asks for inline submodule diffs", options, async () => {
  const inner = await repo_with("diff-sub-inner", { "doc.md": "hello\n" });
  const outer = await repo_with("diff-sub-outer", { "README.md": "r\n" });
  git(outer, "submodule", "add", "-q", posix(inner), "sub");
  git(outer, "commit", "-q", "-m", "add submodule");
  const command = await marker();
  const textconv = await marker();
  const sub = path.join(outer, "sub");
  git(sub, "config", "diff.mark.command", `sh -c 'echo ran > "${command.file}"'`);
  git(sub, "config", "diff.mark.textconv", `sh -c 'echo ran > "${textconv.file}"; cat "$1"' --`);
  await write(sub, { ".gitattributes": "*.md diff=mark\n", "doc.md": "hello\nworld\n" });
  git(outer, "config", "diff.submodule", "diff");
  const head = git(sub, "rev-parse", "HEAD").trim();
  const diff = await diff_of(outer, "sub");
  assert.equal(await command.ran(), false);
  assert.equal(await textconv.ran(), false);
  assert.deepEqual(changed_rows(diff), [`remove Subproject commit ${head}`, `add Subproject commit ${head}-dirty`]);
  git(outer, "diff", "HEAD", "--no-ext-diff", "--no-textconv", "--", "sub");
  assert.equal(await command.ran(), true);
});

const by_path = <T extends { path: string }>(items: T[]): T[] => items.toSorted((left, right) => left.path.localeCompare(right.path));

test("a commit's details carry its message, parents and files with line counts, a rename with both paths, a root commit everything as added", options, async () => {
  const root = await repo_with("commit-detail", { "a.txt": "one\ntwo\n", "old.txt": "keep\nthis\ntext\n", "bin.dat": "\0\u0001\u0002" });
  git(root, "mv", "old.txt", "new.txt");
  await write(root, { "a.txt": "one\nTWO\nthree\n", "b.txt": "b\n" });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "Second commit", "-m", "Body line one\nbody line two");
  const head = git(root, "rev-parse", "HEAD").trim();
  const access = await (await open_session(root)).read_access();
  const reader = create_commit_reader();
  const detail = await reader.detail(access, head.slice(0, 7));
  assert.equal(detail.hash, head);
  assert.equal(detail.parents.length, 1);
  assert.deepEqual([detail.author, detail.email], ["VantheaX Test", "test@example.invalid"]);
  assert.equal(detail.message, "Second commit\n\nBody line one\nbody line two");
  assert.equal(detail.counted, true);
  assert.deepEqual(by_path(detail.files), [
    { status: "modified", path: "a.txt", orig_path: null, added: 2, removed: 1 },
    { status: "added", path: "b.txt", orig_path: null, added: 1, removed: 0 },
    { status: "renamed", path: "new.txt", orig_path: "old.txt", added: 0, removed: 0 },
  ]);
  const first = await reader.detail(access, detail.parents[0]);
  assert.deepEqual(first.parents, []);
  assert.deepEqual(by_path(first.files), [
    { status: "added", path: "a.txt", orig_path: null, added: 2, removed: 0 },
    { status: "added", path: "bin.dat", orig_path: null, added: null, removed: null },
    { status: "added", path: "old.txt", orig_path: null, added: 3, removed: 0 },
  ]);
  assert.deepEqual(changed_rows(await reader.file_diff(access, head, "a.txt")), ["remove two", "add TWO", "add three"]);
  assert.equal((await reader.file_diff(access, head, "old.txt")).kind, "unchanged");
  assert.equal((await reader.file_diff(access, first.hash, "bin.dat")).kind, "binary");
  await assert.rejects(reader.file_diff(access, head, "bin.dat"), /bin\.dat is not a file of commit/);
});

test("a merge commit lists and diffs its files against the first parent", options, async () => {
  const root = await repo_with("commit-merge", { "base.txt": "base\n" });
  git(root, "checkout", "-q", "-b", "side");
  await write(root, { "side.txt": "side\n" });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "side");
  git(root, "checkout", "-q", "main");
  await write(root, { "main.txt": "main\n" });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "main");
  git(root, "merge", "-q", "--no-ff", "-m", "merge side", "side");
  const access = await (await open_session(root)).read_access();
  const detail = await create_commit_reader().detail(access, git(root, "rev-parse", "HEAD").trim());
  assert.equal(detail.parents.length, 2);
  assert.deepEqual(detail.files, [{ status: "added", path: "side.txt", orig_path: null, added: 1, removed: 0 }]);
});

test("a commit file outside the project subfolder and a file deleted since the commit still give their diff", options, async () => {
  const root = await repo_with("commit-subfolder", { "app/main.ts": "export {};\n", "lib/util.ts": "one\n", "gone.txt": "bye\n" });
  await write(root, { "lib/util.ts": "one\ntwo\n", "gone.txt": "bye now\n" });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "touch lib and gone");
  const hash = git(root, "rev-parse", "HEAD").trim();
  git(root, "rm", "-q", "gone.txt");
  git(root, "commit", "-q", "-m", "drop gone");
  const access = await (await open_session(path.join(root, "app"))).read_access();
  const reader = create_commit_reader();
  assert.deepEqual(by_path((await reader.detail(access, hash)).files).map((file) => file.path), ["gone.txt", "lib/util.ts"]);
  assert.deepEqual(changed_rows(await reader.file_diff(access, hash, "lib/util.ts")), ["add two"]);
  assert.deepEqual(changed_rows(await reader.file_diff(access, hash, "gone.txt")), ["remove bye", "add bye now"]);
  await assert.rejects(reader.file_diff(access, hash, "app/main.ts"), /is not a file of commit/);
});

test("a commit in a blobless partial clone lists its files without line counts, and a file diff reports the content as missing", partial_options, async () => {
  const source = await repo_with("commit-partial-source", { "a.txt": "one\ntwo\nthree\nfour\nfive\n", "old.txt": "keep\nthis\ntext\nhere\nplease\n" });
  git(source, "mv", "old.txt", "new.txt");
  await write(source, { "a.txt": "one\nTWO\nthree\nfour\nfive\n", "new.txt": "keep\nthis\ntext\nhere\nplease\nmore\n" });
  git(source, "add", "-A");
  git(source, "commit", "-q", "-m", "edit and rename");
  git(source, "config", "uploadpack.allowFilter", "true");
  const parent = await scratch("commit-partial");
  git(parent, "clone", "-q", "--filter=blob:none", `file:///${posix(source)}`, "clone");
  const root = path.join(parent, "clone");
  const access = await (await open_session(root)).read_access();
  const reader = create_commit_reader();
  const head = git(root, "rev-parse", "HEAD").trim();
  const detail = await reader.detail(access, head);
  assert.equal(detail.counted, false);
  assert.deepEqual(by_path(detail.files), [
    { status: "modified", path: "a.txt", orig_path: null, added: null, removed: null },
    { status: "added", path: "new.txt", orig_path: null, added: null, removed: null },
    { status: "deleted", path: "old.txt", orig_path: null, added: null, removed: null },
  ]);
  assert.equal((await reader.file_diff(access, head, "a.txt")).kind, "object_missing");
  const first = await reader.detail(access, detail.parents[0]);
  assert.equal(first.counted, false);
  assert.deepEqual(by_path(first.files).map((file) => [file.status, file.path]), [["added", "a.txt"], ["added", "old.txt"]]);
});
