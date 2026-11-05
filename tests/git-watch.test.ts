import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import type { GitView } from "../shared/git-view.ts";
import { default_readers } from "../electron/git/readers.ts";
import { create_git_session } from "../electron/git/session.ts";
import { classify_git_path, tree_kinds, watch_git_dirs, type GitWatchKind } from "../electron/git/watch.ts";
import { watch_tree } from "../electron/project/watch.ts";
import { git, quiet_fetcher, quiet_window, repo_with, scratch, skip_without_git, write } from "./git-kit.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("git folder paths map to the reads they trigger", () => {
  const cases: [string, GitWatchKind[]][] = [
    ["index", ["status"]],
    ["HEAD", ["status", "refs"]],
    ["FETCH_HEAD", ["status", "refs"]],
    ["packed-refs", ["status", "refs"]],
    ["refs\\heads\\main", ["status", "refs"]],
    ["refs/remotes/origin/main", ["status", "refs"]],
    ["reftable/tables.list", ["status", "refs"]],
    ["config", ["status", "remotes"]],
    ["info/exclude", ["status"]],
    ["MERGE_HEAD", ["status"]],
    ["rebase-merge/msgnum", ["status"]],
    ["sequencer/todo", ["status"]],
    ["BISECT_LOG", ["status"]],
    ["modules/libs/ops/config", ["status"]],
    ["modules/libs/ops/HEAD", ["status"]],
    ["modules/libs/ops/refs/heads/main", ["status"]],
    ["modules/libs/ops/objects/ab/cdef", []],
    ["objects/ab/cdef", []],
    ["logs/HEAD", []],
    ["hooks/pre-commit", []],
    ["index.lock", []],
    ["refs/heads/main.lock", []],
    ["COMMIT_EDITMSG", []],
    ["description", []],
  ];
  for (const [relative, kinds] of cases) assert.deepEqual(classify_git_path(relative, null), kinds, relative);
});

test("a linked worktree follows its own per-worktree files and ignores other worktrees and the main one", () => {
  assert.deepEqual(classify_git_path("worktrees/mine/HEAD", "mine"), ["status", "refs"]);
  assert.deepEqual(classify_git_path("worktrees/mine/index", "mine"), ["status"]);
  assert.deepEqual(classify_git_path("worktrees/mine/rebase-merge/end", "mine"), ["status"]);
  assert.deepEqual(classify_git_path("worktrees/other/HEAD", "mine"), []);
  assert.deepEqual(classify_git_path("worktrees/other/HEAD", null), []);
  assert.deepEqual(classify_git_path("HEAD", "mine"), []);
  assert.deepEqual(classify_git_path("index", "mine"), []);
  assert.deepEqual(classify_git_path("refs/heads/main", "mine"), ["status", "refs"]);
  assert.deepEqual(classify_git_path("config", "mine"), ["status", "remotes"]);
});

test("tree changes trigger status, the .git path itself and an overflow that may hide it trigger detection", () => {
  assert.deepEqual(tree_kinds({ paths: ["src/a.ts", "node_modules/x/y.js"], overflow: false }), ["status"]);
  assert.deepEqual(tree_kinds({ paths: ["src/a.ts", ".git"], overflow: false }), ["detect"]);
  assert.deepEqual(tree_kinds({ paths: [], overflow: true }), ["detect"]);
  assert.deepEqual(tree_kinds({ paths: [], overflow: false }), []);
});

test("one commit in a real repository gives exactly one status and refs trigger", { skip: skip_without_git }, async () => {
  const root = await repo_with("watch-commit", { "a.txt": "a\n" });
  const seen: GitWatchKind[][] = [];
  const watcher = watch_git_dirs([{ dir: path.join(root, ".git"), own_worktree: null }], (kinds) => seen.push(kinds), () => seen.push(["detect"]), { delay_ms: 300, max_wait_ms: 3000 });
  try {
    await sleep(100);
    await write(root, { "a.txt": "changed\n" });
    git(root, "commit", "-q", "-am", "change");
    for (let waited = 0; waited < 5000 && seen.length === 0; waited += 50) await sleep(50);
    await sleep(600);
  } finally {
    watcher.close();
  }
  assert.equal(seen.length, 1, JSON.stringify(seen));
  assert.deepEqual([...(seen[0] ?? [])].sort(), ["refs", "status"]);
});

test("git init in the folder detects again, later writes inside .git only read status", { skip: skip_without_git }, async () => {
  const root = await scratch("watch-dotgit");
  const views: GitView[] = [];
  let detects = 0;
  const session = create_git_session(
    { path: root, name: path.basename(root), kind: "project" },
    {
      readers: {
        ...default_readers,
        detect: (tool, at, signal) => {
          detects += 1;
          return default_readers.detect(tool, at, signal);
        },
      },
      publish: (_root, view) => views.push(view),
      window: quiet_window,
      fetcher: quiet_fetcher,
    },
  );
  const tree = watch_tree(root, () => undefined, undefined, { path: (event, relative) => session.tree_event(event, relative), failed: () => session.tree_failed() });
  const wait_for = async (done: () => boolean) => {
    for (let waited = 0; waited < 10_000 && !done(); waited += 50) await sleep(50);
  };
  try {
    await wait_for(() => views.at(-1)?.kind === "none");
    assert.equal(detects, 1);
    git(root, "init", "-q", "-b", "main");
    await wait_for(() => views.at(-1)?.kind === "repo");
    assert.equal(views.at(-1)?.kind, "repo");
    const after_init = detects;
    await write(root, { "a.txt": "a\n" });
    git(root, "add", "a.txt");
    git(root, "commit", "-q", "-m", "first");
    await wait_for(() => {
      const last = views.at(-1);
      return last?.kind === "repo" && last.head !== null;
    });
    await sleep(1500);
    assert.equal(detects, after_init);
  } finally {
    tree.close();
    session.stop();
  }
});
