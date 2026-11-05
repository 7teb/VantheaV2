import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { before, test } from "node:test";
import type { ChatMeta, ChatWorktree } from "../shared/chat.ts";
import { append_message, chat_meta, delete_chat, fork_chat } from "../electron/chats/store.ts";
import { create_worktree_chat } from "../electron/worktrees/create.ts";
import { ledger_entries } from "../electron/worktrees/ledger.ts";
import { remove_tree } from "../electron/worktrees/links.ts";
import { release_worktree } from "../electron/worktrees/remove.ts";
import { target_work, worktree_work } from "../electron/worktrees/work.ts";
import { user_message } from "./fixtures/legacy/harness.ts";
import { git, posix, scratch, skip_without_git, write } from "./git-kit.ts";
import { exists, project_repo, worktree_env } from "./worktree-kit.ts";

before(async () => {
  if (!skip_without_git) await worktree_env();
});

const worktree_of = (meta: ChatMeta): ChatWorktree => {
  assert.ok(meta.worktree);
  return meta.worktree;
};

const holder = (meta: ChatMeta) => path.dirname(worktree_of(meta).path);

const release = (meta: ChatMeta, settled: Promise<unknown> = Promise.resolve()) =>
  release_worktree({ chat_id: meta.id, project_path: meta.project_path, worktree: worktree_of(meta), settled });

const worktree_count = (project: string) => git(project, "worktree", "list", "--porcelain").match(/^worktree /gm)?.length ?? 0;

const hold_folder = (dir: string, ms: number): ChildProcess => spawn(process.execPath, ["-e", `setTimeout(() => {}, ${ms})`], { cwd: dir, stdio: "ignore" });

const exited = (child: ChildProcess) => new Promise<void>((resolve) => (child.exitCode !== null ? resolve() : child.once("exit", () => resolve())));

test("removing a tree unlinks junctions and never touches what they point at", async () => {
  const root = await scratch("wt-tree");
  const target = path.join(root, "target");
  await write(target, { "keep.txt": "keep", "deep/keep.txt": "deep" });
  const tree = path.join(root, "tree");
  await write(tree, { "own.txt": "own", "sub/own.txt": "own" });
  await fs.symlink(target, path.join(tree, "node_modules"), "junction");
  await fs.symlink(target, path.join(tree, "sub", "agent-link"), "junction");
  await fs.chmod(path.join(tree, "own.txt"), 0o444);
  await remove_tree(tree);
  assert.equal(await exists(tree), false);
  assert.equal(await fs.readFile(path.join(target, "keep.txt"), "utf8"), "keep");
  assert.equal(await fs.readFile(path.join(target, "deep", "keep.txt"), "utf8"), "deep");
});

test("deleting a dirty worktree counts its work, removes the folder, prunes git and keeps the branch", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-dirty", { "a.txt": "a\n" });
  await write(project, { "node_modules/pkg/index.js": "1\n" });
  const meta = await create_worktree_chat(project, "dirty work");
  const tree = worktree_of(meta);
  await write(tree.path, { "b.txt": "b\n" });
  git(tree.path, "add", "b.txt");
  git(tree.path, "commit", "-q", "-m", "b");
  await write(tree.path, { "a.txt": "changed\n", "new.txt": "new\n" });
  assert.deepEqual(await worktree_work({ ...meta, worktree: tree }, []), {
    chat_id: meta.id,
    title: "",
    branch: tree.branch,
    changed: 2,
    unpushed: 1,
    missing: false,
    shared: false,
  });
  const remote = await scratch("wt-remote");
  git(remote, "init", "-q", "--bare");
  git(tree.path, "remote", "add", "origin", posix(remote));
  git(tree.path, "push", "-q", "origin", tree.branch);
  assert.equal((await target_work({ kind: "chats", chat_ids: [meta.id] }))[0]?.unpushed, 0);
  assert.equal(worktree_count(project), 2);
  await delete_chat(meta.id);
  await release(meta);
  assert.equal(await exists(holder(meta)), false);
  assert.equal(await fs.readFile(path.join(project, "node_modules", "pkg", "index.js"), "utf8"), "1\n");
  assert.equal(worktree_count(project), 1);
  assert.match(git(project, "rev-parse", "--verify", `refs/heads/${tree.branch}`), /^[0-9a-f]{40}/);
  assert.deepEqual(await ledger_entries(), []);
});

test("a fork shares the worktree, which stays until the last chat using it is deleted", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-fork");
  const meta = await create_worktree_chat(project, "fork me");
  await append_message(meta.id, user_message("u1", "fork me"));
  const fork = await fork_chat(meta.id, "u1");
  assert.deepEqual(fork.worktree, meta.worktree);
  const work = await target_work({ kind: "chats", chat_ids: [meta.id] });
  assert.equal(work.length, 1);
  assert.equal(work[0]?.shared, true);
  assert.equal((await target_work({ kind: "chats", chat_ids: [meta.id, fork.id] }))[0]?.shared, false);
  await delete_chat(meta.id);
  await release(meta);
  assert.equal(await exists(holder(meta)), true);
  await delete_chat(fork.id);
  await release(fork);
  assert.equal(await exists(holder(meta)), false);
});

test("a turn still running holds the removal until it settles", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-turn");
  const meta = await create_worktree_chat(project, "long turn");
  let settle = () => {};
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  await delete_chat(meta.id);
  const pending = release(meta, settled);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(await exists(worktree_of(meta).path), true);
  assert.deepEqual((await ledger_entries()).map((entry) => [entry.path, entry.state]), [[worktree_of(meta).path, "removing"]]);
  settle();
  await pending;
  assert.equal(await exists(holder(meta)), false);
  assert.deepEqual(await ledger_entries(), []);
});

test("a folder locked for a moment is removed on a retry", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-busy");
  const meta = await create_worktree_chat(project, "busy folder");
  const child = hold_folder(worktree_of(meta).path, 350);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await delete_chat(meta.id);
  await release(meta);
  await exited(child);
  assert.equal(await exists(holder(meta)), false);
  assert.deepEqual(await ledger_entries(), []);
});

test("a folder that stays locked keeps its ledger entry for the next start", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-locked");
  const meta = await create_worktree_chat(project, "locked folder");
  const child = hold_folder(worktree_of(meta).path, 20_000);
  await new Promise((resolve) => setTimeout(resolve, 100));
  try {
    await delete_chat(meta.id);
    await assert.rejects(release(meta), /removing the worktree folder .* failed: EBUSY/);
    assert.deepEqual((await ledger_entries()).map((entry) => [entry.path, entry.state]), [[worktree_of(meta).path, "removing"]]);
    assert.equal(chat_meta(meta.id), null);
  } finally {
    child.kill();
    await exited(child);
  }
});
