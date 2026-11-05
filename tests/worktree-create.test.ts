import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { before, test } from "node:test";
import { chat_meta } from "../electron/chats/store.ts";
import { chat_root } from "../electron/chats/workspace.ts";
import { create_worktree_chat } from "../electron/worktrees/create.ts";
import { worktree_eligibility } from "../electron/worktrees/eligibility.ts";
import { ledger_entries } from "../electron/worktrees/ledger.ts";
import { git, marker, posix, scratch, skip_without_git, write } from "./git-kit.ts";
import { commit_all, exists, listed_project, project_repo, worktree_env, type WorktreeEnv } from "./worktree-kit.ts";

let env: WorktreeEnv;

before(async () => {
  if (!skip_without_git) env = await worktree_env();
});

const head_of = (dir: string) => git(dir, "rev-parse", "HEAD").trim();

const branches = (dir: string) => git(dir, "for-each-ref", "--format=%(refname:strip=2)", "refs/heads/").split(/\r?\n/).filter(Boolean);

test("a new worktree chat gets its own branch and folder under the storage root, from HEAD", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-basic", { "src/app.ts": "export {}\n" });
  const meta = await create_worktree_chat(project, "Fix the login bug in auth, please");
  const worktree = meta.worktree;
  assert.ok(worktree);
  assert.equal(worktree.branch, "vx/fix-the-login-bug-in");
  assert.equal(worktree.base, head_of(project));
  assert.equal(worktree.prefix, "");
  assert.equal(path.dirname(path.dirname(worktree.path)), env.worktrees);
  assert.match(path.basename(path.dirname(worktree.path)), /^[0-9a-f]{8}$/);
  assert.equal(path.basename(worktree.path), path.basename(project));
  assert.equal(meta.project_path, project);
  assert.deepEqual(chat_meta(meta.id)?.worktree, worktree);
  assert.equal(await chat_root(meta), worktree.path);
  assert.equal(git(worktree.path, "rev-parse", "--abbrev-ref", "HEAD").trim(), "vx/fix-the-login-bug-in");
  assert.match(await fs.readFile(path.join(worktree.path, "src", "app.ts"), "utf8"), /^export \{\}\r?\n$/);
  assert.equal(git(project, "rev-parse", "--abbrev-ref", "HEAD").trim(), "main");
  assert.deepEqual(await ledger_entries(), []);
});

test("a taken branch name gets the next number", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-taken");
  git(project, "branch", "vx/add-tests");
  const first = await create_worktree_chat(project, "Add tests");
  const second = await create_worktree_chat(project, "add TESTS");
  assert.equal(first.worktree?.branch, "vx/add-tests-2");
  assert.equal(second.worktree?.branch, "vx/add-tests-3");
  assert.notEqual(first.worktree?.path, second.worktree?.path);
});

test("an empty first message names the branch after the folder id", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-empty");
  const meta = await create_worktree_chat(project, "");
  const id = path.basename(path.dirname(meta.worktree?.path ?? ""));
  assert.equal(meta.worktree?.branch, `vx/chat-${id.slice(0, 6)}`);
});

test("a detached HEAD in the main checkout is the base of the new branch", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-detached");
  const first = head_of(project);
  await write(project, { "later.txt": "later\n" });
  commit_all(project, "later");
  git(project, "checkout", "-q", "--detach", first);
  assert.deepEqual(await worktree_eligibility(project), { kind: "ready", branch: null, submodules: false });
  const meta = await create_worktree_chat(project, "detached work");
  assert.equal(meta.worktree?.base, first);
  assert.equal(head_of(meta.worktree?.path ?? ""), first);
  assert.equal(await exists(path.join(meta.worktree?.path ?? "", "later.txt")), false);
});

test("a repository without commits cannot get a worktree", { skip: skip_without_git }, async () => {
  const dir = await scratch("wt-unborn");
  git(dir, "init", "-q", "-b", "main");
  const project = await listed_project(dir);
  assert.deepEqual(await worktree_eligibility(project), { kind: "no_commits", branch: "main" });
  await assert.rejects(create_worktree_chat(project, "first"), /worktree step "check repository" failed: the repository has no commit yet/);
  assert.deepEqual(branches(project), []);
});

test("a plain folder is not a repository and a subfolder outside the last commit is refused", { skip: skip_without_git }, async () => {
  const plain = await listed_project(await scratch("wt-plain"));
  assert.deepEqual(await worktree_eligibility(plain), { kind: "not_repo" });
  const repo = await project_repo("wt-untracked");
  const sub = path.join(repo, "fresh");
  await write(repo, { "fresh/new.txt": "new\n" });
  await listed_project(sub);
  assert.deepEqual(await worktree_eligibility(sub), { kind: "untracked_folder", branch: "main" });
  await assert.rejects(create_worktree_chat(sub, "x"), /the project folder is not in the last commit/);
});

test("a filter in the repository's own configuration refuses the worktree before its smudge program can run", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-filter", { "a.txt": "a\n" });
  const seen = await marker();
  await write(project, { ".gitattributes": "*.txt filter=probe\n" });
  commit_all(project, "attributes");
  git(project, "config", "filter.probe.smudge", `sh -c 'echo ran >> "${seen.file}"; cat'`);
  git(project, "config", "filter.probe.clean", "cat");
  const before = await fs.readdir(env.worktrees);
  assert.deepEqual(await worktree_eligibility(project), { kind: "programs", keys: ["filter.probe"], branch: "main" });
  await assert.rejects(create_worktree_chat(project, "probe the filter"), /Repository configuration starts programs \(filter\.probe\), use a terminal/);
  assert.equal(await seen.ran(), false);
  assert.deepEqual(await fs.readdir(env.worktrees), before);
  assert.deepEqual(branches(project), ["main"]);
});

test("a project in a subfolder gets the whole repository and works in the same subfolder", { skip: skip_without_git }, async () => {
  const repo = await project_repo("wt-sub", { "apps/web/index.ts": "web\n", "apps/api/index.ts": "api\n" });
  const project = await listed_project(path.join(repo, "apps", "web"));
  const meta = await create_worktree_chat(project, "web change");
  const worktree = meta.worktree;
  assert.ok(worktree);
  assert.equal(worktree.prefix, "apps/web");
  assert.equal(path.basename(worktree.path), path.basename(repo));
  assert.equal(await chat_root(meta), path.join(worktree.path, "apps", "web"));
  assert.match(await fs.readFile(path.join(worktree.path, "apps", "api", "index.ts"), "utf8"), /^api\r?\n$/);
});

test("submodules are reported and stay empty in the new worktree", { skip: skip_without_git }, async () => {
  const library = await project_repo("wt-lib", { "lib.txt": "lib\n" });
  const project = await project_repo("wt-super");
  git(project, "submodule", "add", "-q", posix(library), "vendor/lib");
  commit_all(project, "add submodule");
  assert.deepEqual(await worktree_eligibility(project), { kind: "ready", branch: "main", submodules: true });
  const meta = await create_worktree_chat(project, "with submodule");
  const vendor = path.join(meta.worktree?.path ?? "", "vendor", "lib");
  assert.deepEqual(await fs.readdir(vendor), []);
});

test("node_modules of the project is linked into the worktree and git status stays clean", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-modules");
  await write(project, { "node_modules/pkg/index.js": "module.exports = 1;\n" });
  const meta = await create_worktree_chat(project, "modules");
  const link = path.join(meta.worktree?.path ?? "", "node_modules");
  assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
  assert.equal(await fs.readFile(path.join(link, "pkg", "index.js"), "utf8"), "module.exports = 1;\n");
  assert.equal(git(meta.worktree?.path ?? "", "status", "--porcelain"), "");
});

test(".worktreeinclude copies ignored files that match it and nothing else", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-include", { ".worktreeinclude": ".env.local\nconfig/*.secret\ntracked.secret\n", "tracked.secret": "in git\n" });
  await write(project, { ".env.local": "TOKEN=1\n", ".env.other": "OTHER=1\n", "config/db.secret": "db\n", "config/notes.txt": "notes\n" });
  await fs.appendFile(path.join(project, ".gitignore"), "*.secret\nconfig/notes.txt\n");
  commit_all(project, "ignore secrets");
  const meta = await create_worktree_chat(project, "include");
  const top = meta.worktree?.path ?? "";
  assert.equal(await fs.readFile(path.join(top, ".env.local"), "utf8"), "TOKEN=1\n");
  assert.equal(await fs.readFile(path.join(top, "config", "db.secret"), "utf8"), "db\n");
  assert.match(await fs.readFile(path.join(top, "tracked.secret"), "utf8"), /^in git\r?\n$/);
  assert.equal(await exists(path.join(top, ".env.other")), false);
  assert.equal(await exists(path.join(top, "config", "notes.txt")), false);
});

test("a failing step leaves no folder, no ledger entry and no branch behind", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-fail", { conf: "a file in HEAD\n", ".worktreeinclude": "conf/\n" });
  await fs.rm(path.join(project, "conf"));
  await write(project, { "conf/.env.local": "SECRET=1\n" });
  const before = await fs.readdir(env.worktrees);
  await assert.rejects(create_worktree_chat(project, "will fail"), /worktree step "copy \.worktreeinclude files" failed/);
  assert.deepEqual(await fs.readdir(env.worktrees), before);
  assert.deepEqual(await ledger_entries(), []);
  assert.deepEqual(branches(project), ["main"]);
  assert.equal(git(project, "worktree", "list", "--porcelain").match(/^worktree /gm)?.length, 1);
});
