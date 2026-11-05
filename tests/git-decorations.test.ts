import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitEntry, GitFileStatus } from "../shared/git-view.ts";
import { decoration_of, git_decorations } from "../shared/git/decorations.ts";

const entry = (path: string, status: GitFileStatus, extra: Partial<GitEntry> = {}): GitEntry => ({
  path,
  orig_path: null,
  status,
  staged: false,
  unstaged: true,
  conflict: null,
  submodule: null,
  nested_repo: false,
  ...extra,
});

test("folders take the strongest mark below them, conflict over change over untracked", () => {
  const decorations = git_decorations([entry("src/a/new.ts", "untracked"), entry("src/a/b.ts", "modified"), entry("src/c/x.ts", "untracked"), entry("src/c/d/e.ts", "conflicted")]);
  assert.equal(decoration_of(decorations, "src/a", true)?.status, "modified");
  assert.equal(decoration_of(decorations, "src/c", true)?.status, "conflicted");
  assert.equal(decoration_of(decorations, "src", true)?.status, "conflicted");
  assert.equal(decoration_of(decorations, "src", true)?.rollup, true);
  assert.equal(decoration_of(decorations, "src/a/b.ts", false)?.status, "modified");
  assert.equal(decoration_of(decorations, "src/a/b.ts", false)?.rollup, false);
});

test("deleted files mark only their parent folder and ignored entries never bubble", () => {
  const decorations = git_decorations([entry("a/b/old.ts", "deleted"), entry("logs/x.log", "ignored")]);
  assert.equal(decoration_of(decorations, "a/b", true)?.status, "deleted");
  assert.equal(decoration_of(decorations, "a", true), null);
  assert.equal(decoration_of(decorations, "logs", true), null);
  assert.equal(decoration_of(decorations, "logs/x.log", false)?.status, "ignored");
});

test("untracked and ignored folders cover everything below them by prefix", () => {
  const decorations = git_decorations([entry("newdir/", "untracked"), entry("node_modules/", "ignored"), entry("newdir/build/", "ignored")]);
  assert.equal(decoration_of(decorations, "newdir", true)?.status, "untracked");
  assert.equal(decoration_of(decorations, "newdir/deep/file.ts", false)?.status, "untracked");
  assert.equal(decoration_of(decorations, "node_modules/react/index.js", false)?.status, "ignored");
  assert.equal(decoration_of(decorations, "newdir/build/out.js", false)?.status, "ignored");
  assert.equal(decoration_of(decorations, "newdirx/file.ts", false), null);
});

test("an own repository folder is marked but its content is not untracked", () => {
  const decorations = git_decorations([entry("nested/", "untracked", { nested_repo: true })]);
  assert.equal(decoration_of(decorations, "nested", true)?.entry?.nested_repo, true);
  assert.equal(decoration_of(decorations, "nested/src/a.ts", false), null);
});

test("lookups ignore case and backslashes", () => {
  const decorations = git_decorations([entry("Src/Foo.TS", "modified"), entry("Gen/", "untracked")]);
  assert.equal(decoration_of(decorations, "src/foo.ts", false)?.status, "modified");
  assert.equal(decoration_of(decorations, "SRC", true)?.status, "modified");
  assert.equal(decoration_of(decorations, "gen\\x.ts", false)?.status, "untracked");
});
