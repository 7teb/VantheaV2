import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { before, test } from "node:test";
import { chat_meta, list_chats } from "../electron/chats/store.ts";
import { chat_root, is_worktree_missing } from "../electron/chats/workspace.ts";
import { commit_changes } from "../electron/git/commit-changes.ts";
import { push_branch } from "../electron/git/push.ts";
import { create_worktree_chat } from "../electron/worktrees/create.ts";
import { release_worktree } from "../electron/worktrees/remove.ts";
import { restore_worktree } from "../electron/worktrees/restore.ts";
import { worktree_work } from "../electron/worktrees/work.ts";
import { git, scratch, skip_without_git, write } from "./git-kit.ts";
import { target_of } from "./git-fetch-kit.ts";
import { access_of, identity_config, repo_view, write_guard_of } from "./git-write-kit.ts";
import { commit_all, exists, project_repo, worktree_env } from "./worktree-kit.ts";

const options = { skip: skip_without_git };

before(async () => {
  if (skip_without_git) return;
  await identity_config();
  await worktree_env();
});

const file_url = (dir: string) => `file:///${dir.replaceAll("\\", "/")}`;

const head_of = (dir: string, ref = "HEAD") => git(dir, "rev-parse", ref).trim();

const project_with_remote = async (prefix: string) => {
  const project = await project_repo(prefix, { "src/app.ts": "export const app = 1\n", ".worktreeinclude": ".env\n" });
  const bare = path.join(await scratch(`${prefix}-bare`), "origin.git");
  git(project, "init", "-q", "--bare", "-b", "main", bare);
  git(project, "remote", "add", "origin", file_url(bare));
  git(project, "push", "-q", "-u", "origin", "main");
  await write(project, { "node_modules/pkg/index.js": "module.exports = 42\n", ".env": "TOKEN=local\n" });
  return { project, bare };
};

const commit = async (dir: string, message: string) => commit_changes(await access_of(dir), await write_guard_of(dir), message);

const push = async (dir: string) => push_branch(await target_of(dir), await repo_view(dir), await write_guard_of(dir));

const worktree_of = (chat_id: string) => {
  const worktree = chat_meta(chat_id)?.worktree;
  assert.ok(worktree, `chat ${chat_id} has a worktree`);
  return worktree;
};

test("a worktree chat commits and pushes its own branch while the main checkout stays untouched", options, async () => {
  const { project, bare } = await project_with_remote("e2e-flow");
  const main_head = head_of(project);
  const meta = await create_worktree_chat(project, "Add the login page");
  const worktree = worktree_of(meta.id);
  const dir = await chat_root(meta);
  assert.equal(dir, worktree.path);
  assert.equal(worktree.branch, "vx/add-the-login-page");

  const modules = await fs.lstat(path.join(dir, "node_modules"));
  assert.ok(modules.isSymbolicLink(), "node_modules in the worktree is a link");
  assert.equal(await fs.readFile(path.join(dir, "node_modules", "pkg", "index.js"), "utf8"), "module.exports = 42\n");
  assert.equal(await fs.readFile(path.join(dir, ".env"), "utf8"), "TOKEN=local\n");

  await write(dir, { "src/login.ts": "export const login = () => true\n", "credentials.json": "{}\n" });
  const first = await commit(dir, "Add the login page");
  assert.equal(first.kind, "done");
  assert.deepEqual(first.kind === "done" ? first.left_out : [], ["credentials.json"]);
  assert.match(git(dir, "show", "--name-only", "--format=", "HEAD"), /src\/login\.ts/);
  assert.doesNotMatch(git(dir, "show", "--name-only", "--format=", "HEAD"), /credentials\.json|node_modules|\.env/);
  assert.equal(head_of(project), main_head, "the main checkout has no new commit");
  assert.equal(git(project, "status", "--porcelain").trim(), "", "the main checkout has no changes");

  assert.deepEqual(await push(dir), { kind: "done", remote: "origin", branch: "vx/add-the-login-page" });
  assert.equal(head_of(bare, "vx/add-the-login-page"), head_of(dir));
  assert.equal(git(dir, "rev-parse", "--abbrev-ref", "@{upstream}").trim(), "origin/vx/add-the-login-page");
  assert.equal(head_of(bare, "main"), main_head, "the remote main did not move");

  await write(dir, { "src/login.ts": "export const login = () => false\n" });
  const second = await commit(dir, "Refuse logins for now");
  assert.equal(second.kind, "done");
  assert.deepEqual(await push(dir), { kind: "done", remote: "origin", branch: "vx/add-the-login-page" });
  assert.equal(head_of(bare, "vx/add-the-login-page"), head_of(dir));

  const other = path.join(await scratch("e2e-flow-other"), "w");
  git(project, "clone", "-q", "-b", "vx/add-the-login-page", file_url(bare), other);
  await write(other, { "other.txt": "from someone else\n" });
  commit_all(other, "Someone else pushes first");
  git(other, "push", "-q", "origin", "vx/add-the-login-page");
  await write(dir, { "src/late.ts": "export {}\n" });
  assert.equal((await commit(dir, "A commit that loses the race")).kind, "done");
  assert.deepEqual(await push(dir), { kind: "rejected", remote: "origin" });

  assert.equal((await commit(dir, "Nothing left")).kind, "nothing");
});

test("deleting a dirty worktree chat reports its work, removes only the worktree folder and keeps the branch and node_modules", options, async () => {
  const { project } = await project_with_remote("e2e-delete");
  const meta = await create_worktree_chat(project, "Try the risky refactor");
  const worktree = worktree_of(meta.id);
  await write(worktree.path, { "src/risky.ts": "export const risky = 1\n" });
  assert.equal((await commit(worktree.path, "Risky step one")).kind, "done");
  await write(worktree.path, { "src/unsaved.ts": "export const unsaved = 1\n" });

  const work = await worktree_work({ ...chat_meta(meta.id)!, worktree }, list_chats());
  assert.equal(work.changed, 1);
  assert.equal(work.unpushed, 1);
  assert.equal(work.missing, false);

  await release_worktree({ chat_id: meta.id, project_path: project, worktree, settled: Promise.resolve() });
  assert.equal(await exists(path.dirname(worktree.path)), false, "the worktree's id folder is gone");
  assert.equal(await fs.readFile(path.join(project, "node_modules", "pkg", "index.js"), "utf8"), "module.exports = 42\n");
  assert.equal(await fs.readFile(path.join(project, ".env"), "utf8"), "TOKEN=local\n");
  assert.match(git(project, "branch", "--list", worktree.branch), /vx\/try-the-risky-refactor/);
  assert.doesNotMatch(git(project, "worktree", "list"), new RegExp(path.basename(path.dirname(worktree.path))));
});

test("a vanished worktree folder never falls back to the main checkout and Restore brings back the branch with its commits", options, async () => {
  const { project } = await project_with_remote("e2e-restore");
  const meta = await create_worktree_chat(project, "Keep this work safe");
  const worktree = worktree_of(meta.id);
  await write(worktree.path, { "src/safe.ts": "export const safe = 1\n" });
  assert.equal((await commit(worktree.path, "Safe work")).kind, "done");
  const committed = head_of(worktree.path);

  await fs.unlink(path.join(worktree.path, "node_modules"));
  await fs.rm(path.dirname(worktree.path), { recursive: true, force: true });
  await assert.rejects(chat_root(chat_meta(meta.id)!), (error: unknown) => is_worktree_missing(error));
  assert.equal(await fs.readFile(path.join(project, "node_modules", "pkg", "index.js"), "utf8"), "module.exports = 42\n");

  const restored = await restore_worktree(meta.id);
  const dir = await chat_root(restored);
  assert.equal(dir, worktree.path);
  assert.equal(head_of(dir), committed);
  assert.equal(git(dir, "rev-parse", "--abbrev-ref", "HEAD").trim(), worktree.branch);
  assert.equal(await fs.readFile(path.join(dir, "src", "safe.ts"), "utf8"), "export const safe = 1\n");
  assert.ok((await fs.lstat(path.join(dir, "node_modules"))).isSymbolicLink(), "node_modules is linked again");
  assert.equal(await fs.readFile(path.join(dir, ".env"), "utf8"), "TOKEN=local\n");
});

test("a repository hook never runs on Commit or Push from the panel", options, async () => {
  const { project } = await project_with_remote("e2e-hooks");
  const marker = path.join(await scratch("e2e-hooks-marker"), "ran.txt");
  const hook = `#!/bin/sh\necho ran > '${marker.replaceAll("\\", "/")}'\nexit 1\n`;
  await write(project, { ".git/hooks/pre-commit": hook, ".git/hooks/pre-push": hook });
  await write(project, { "src/hooked.ts": "export {}\n" });
  assert.equal((await commit(project, "Commit past the hook")).kind, "done");
  assert.equal((await push(project)).kind, "done");
  assert.equal(await exists(marker), false, "neither hook ran");
});
