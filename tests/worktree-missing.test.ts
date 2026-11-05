import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { before, test } from "node:test";
import { chat_root, is_worktree_missing } from "../electron/chats/workspace.ts";
import { files_root, require_root } from "../electron/project/files-root.ts";
import { create_worktree_chat } from "../electron/worktrees/create.ts";
import { chat_worktree_head, worktree_head } from "../electron/worktrees/head.ts";
import { remove_tree } from "../electron/worktrees/links.ts";
import { restore_worktree } from "../electron/worktrees/restore.ts";
import { target_work } from "../electron/worktrees/work.ts";
import { git, marker, skip_without_git, write } from "./git-kit.ts";
import { exists, project_repo, worktree_env } from "./worktree-kit.ts";

before(async () => {
  if (!skip_without_git) await worktree_env();
});

test("a chat whose worktree folder is gone never falls back to the main project", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-missing");
  const meta = await create_worktree_chat(project, "will vanish");
  const tree = meta.worktree;
  assert.ok(tree);
  assert.deepEqual(await worktree_head(tree), { branch: tree.branch, detached_at: null, missing: false });
  await remove_tree(path.dirname(tree.path));
  await assert.rejects(chat_root(meta), (error: unknown) => is_worktree_missing(error) && /worktree folder of this chat is missing/.test(String(error)));
  assert.deepEqual(await files_root({ chat_id: meta.id, project_path: "" }), {
    path: tree.path,
    name: path.basename(project),
    kind: "project",
    worktree: { branch: tree.branch, missing: true },
  });
  await assert.rejects(require_root({ chat_id: meta.id, project_path: "" }), /worktree folder of this chat is missing/);
  assert.deepEqual(await chat_worktree_head(meta.id), { branch: null, detached_at: null, missing: true });
});

test("a detached HEAD in the worktree reports its commit and no branch", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-head-detached");
  const meta = await create_worktree_chat(project, "detach me");
  const tree = meta.worktree;
  assert.ok(tree);
  git(tree.path, "checkout", "-q", "--detach");
  assert.deepEqual(await worktree_head(tree), { branch: null, detached_at: git(tree.path, "rev-parse", "HEAD").trim(), missing: false });
});

test("restoring re-adds the worktree from its kept branch and links node_modules again", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-restore");
  await write(project, { "node_modules/pkg/index.js": "1\n" });
  const meta = await create_worktree_chat(project, "restore me");
  const tree = meta.worktree;
  assert.ok(tree);
  await write(tree.path, { "work.txt": "committed work\n" });
  git(tree.path, "add", "work.txt");
  git(tree.path, "commit", "-q", "-m", "work");
  await remove_tree(path.dirname(tree.path));
  assert.deepEqual(await target_work({ kind: "chats", chat_ids: [meta.id] }), [
    { chat_id: meta.id, title: "", branch: tree.branch, changed: 0, unpushed: 1, missing: true, shared: false },
  ]);
  const restored = await restore_worktree(meta.id);
  assert.deepEqual(restored.worktree, tree);
  assert.equal(await chat_root(meta), tree.path);
  assert.match(await fs.readFile(path.join(tree.path, "work.txt"), "utf8"), /^committed work\r?\n$/);
  assert.equal(git(tree.path, "rev-parse", "--abbrev-ref", "HEAD").trim(), tree.branch);
  assert.equal((await fs.lstat(path.join(tree.path, "node_modules"))).isSymbolicLink(), true);
  assert.deepEqual(await files_root({ chat_id: meta.id, project_path: "" }), {
    path: tree.path,
    name: path.basename(project),
    kind: "project",
    worktree: { branch: tree.branch, missing: false },
  });
});

test("restoring fails when the branch of the worktree was deleted and creates nothing", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-gone");
  const meta = await create_worktree_chat(project, "branch goes");
  const tree = meta.worktree;
  assert.ok(tree);
  await remove_tree(path.dirname(tree.path));
  git(project, "worktree", "prune");
  git(project, "branch", "-q", "-D", tree.branch);
  await assert.rejects(restore_worktree(meta.id), /The branch .* no longer exists/);
  assert.equal(await exists(path.dirname(tree.path)), false);
});

test("restoring is refused when the repository's own configuration sets a filter, before any checkout", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-restore-filter");
  const meta = await create_worktree_chat(project, "filter later");
  const tree = meta.worktree;
  assert.ok(tree);
  await remove_tree(path.dirname(tree.path));
  const seen = await marker();
  await write(project, { ".git/info/attributes": "* filter=probe\n" });
  git(project, "config", "filter.probe.smudge", `sh -c 'echo ran >> "${seen.file}"; cat'`);
  await assert.rejects(restore_worktree(meta.id), /Repository configuration starts programs \(filter\.probe\), use a terminal/);
  assert.equal(await seen.ran(), false);
  assert.equal(await exists(tree.path), false);
});
