import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { classify_detect_failure, detect_repo, git_location } from "../electron/git/repo.ts";
import { first_view, git, posix, repo_with, scratch, skip_without_git, tool, write } from "./git-kit.ts";

const options = { skip: skip_without_git };

test("a folder outside any repository gives none (G4)", options, async () => {
  const root = await scratch("repo-none");
  assert.deepEqual(await detect_repo(tool(), root), { kind: "none" });
  assert.deepEqual(await first_view(root), { kind: "none" });
});

test("a fresh git init is an unborn repository with every file added or untracked (G10)", options, async () => {
  const root = await scratch("repo-unborn");
  git(root, "init", "-q", "-b", "main");
  await write(root, { "a.txt": "a\n", "b.txt": "b\n" });
  git(root, "add", "a.txt");
  const view = await first_view(root);
  assert.equal(view.kind, "repo");
  if (view.kind !== "repo") return;
  assert.deepEqual(view.branch, { name: "main", detached_at: null, unborn: true, upstream: null, upstream_gone: false, ahead: null, behind: null, stash: 0 });
  assert.equal(view.head, null);
  assert.deepEqual(view.entries.map((entry) => [entry.path, entry.status]), [["a.txt", "added"], ["b.txt", "untracked"]]);
  assert.deepEqual(view.remotes, []);
  assert.equal(view.primary_remote, null);
  assert.equal(view.repo.root, posix(root));
});

test("a detached head carries the commit and no branch name (G15)", options, async () => {
  const root = await repo_with("repo-detached", { "a.txt": "a\n" });
  git(root, "checkout", "-q", "--detach");
  const head = git(root, "rev-parse", "HEAD").trim();
  const view = await first_view(root);
  assert.equal(view.kind === "repo" ? view.branch.name : "x", null);
  assert.equal(view.kind === "repo" ? view.branch.detached_at : null, head);
});

test("a project below the repository root sees only its own entries, relative to itself (G19)", options, async () => {
  const root = await repo_with("repo-sub", { "src/a.ts": "a\n", "other/b.ts": "b\n" });
  await write(root, { "src/a.ts": "changed\n", "other/b.ts": "changed\n", "src/new.ts": "n\n" });
  const view = await first_view(path.join(root, "src"));
  assert.equal(view.kind, "repo");
  if (view.kind !== "repo") return;
  assert.equal(view.repo.prefix, "src");
  assert.equal(view.repo.root, posix(root));
  assert.deepEqual(view.entries.map((entry) => [entry.path, entry.status]).sort(), [["a.ts", "modified"], ["new.ts", "untracked"]]);
});

test("a project that is itself a submodule names its superproject (G21)", options, async () => {
  const sub = await repo_with("repo-subsource", { "lib.txt": "x\n" });
  const parent = await repo_with("repo-super", { "README.md": "r\n" });
  git(parent, "submodule", "add", "-q", sub, "libs/ops");
  git(parent, "commit", "-q", "-m", "add submodule");
  const view = await first_view(path.join(parent, "libs", "ops"));
  assert.equal(view.kind === "repo" ? view.repo.superproject : null, posix(parent));
  const outer = await first_view(parent);
  assert.equal(outer.kind === "repo" ? outer.repo.superproject : "x", null);
});

test("an own repository inside the project is marked instead of untracked content (G22)", options, async () => {
  const root = await repo_with("repo-nested", { "a.txt": "a\n" });
  const inner = path.join(root, "inner");
  await fs.mkdir(inner);
  git(inner, "init", "-q", "-b", "main");
  await write(root, { "inner/x.txt": "x\n", "plain/y.txt": "y\n" });
  const view = await first_view(root);
  assert.equal(view.kind, "repo");
  if (view.kind !== "repo") return;
  assert.deepEqual(view.entries.map((entry) => [entry.path, entry.status, entry.nested_repo]).sort(), [["inner/", "untracked", true], ["plain/", "untracked", false]]);
});

test("a linked worktree names the main worktree (G23)", options, async () => {
  const root = await repo_with("repo-main", { "a.txt": "a\n" });
  const linked = path.join(path.dirname(root), `${path.basename(root)}-wt`);
  git(root, "worktree", "add", "-q", "-b", "side", linked);
  try {
    const view = await first_view(linked);
    assert.equal(view.kind === "repo" ? view.repo.worktree_of : null, posix(root));
    assert.equal(view.kind === "repo" ? view.branch.name : null, "side");
    const main = await first_view(root);
    assert.equal(main.kind === "repo" ? main.repo.worktree_of : "x", null);
  } finally {
    await fs.rm(linked, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("a project folder that is untracked in a parent repository gives a hint, a chat workspace gives nothing (G5)", options, async () => {
  const root = await repo_with("repo-parent", { "a.txt": "a\n" });
  await write(root, { "project/file.txt": "f\n" });
  const project = path.join(root, "project");
  assert.deepEqual(await first_view(project, "project"), { kind: "outside_tracked", repo_root: posix(root) });
  assert.deepEqual(await first_view(project, "workspace"), { kind: "none" });
  await write(root, { ".gitignore": "ignored-project/\n", "ignored-project/x.txt": "x\n" });
  assert.deepEqual(await first_view(path.join(root, "ignored-project"), "project"), { kind: "outside_tracked", repo_root: posix(root) });
});

test("a bare repository and the git directory itself give none (G7)", options, async () => {
  const root = await scratch("repo-bare");
  git(root, "init", "-q", "--bare", "b.git");
  assert.deepEqual(await detect_repo(tool(), path.join(root, "b.git")), { kind: "none" });
  const normal = await repo_with("repo-gitdir", { "a.txt": "a\n" });
  assert.deepEqual(await detect_repo(tool(), path.join(normal, ".git")), { kind: "none" });
});

test("a .git file that points to a missing folder is an error with its own reason, not none (G8)", options, async () => {
  const root = await scratch("repo-gitfile");
  await write(root, { ".git": "gitdir: ./missing/worktree\n", "a.txt": "a\n" });
  const detected = await detect_repo(tool(), root);
  assert.equal(detected.kind, "error");
  assert.equal(detected.kind === "error" ? detected.broken_gitfile : false, true);
  assert.equal((await git_location(root))?.dot_git, "file");
});

test("a broken config is an error with git's own line (G8)", options, async () => {
  const root = await repo_with("repo-badconfig", { "a.txt": "a\n" });
  await fs.appendFile(path.join(root, ".git", "config"), "\n[broken\n");
  const view = await first_view(root);
  assert.equal(view.kind, "error");
  assert.match(view.kind === "error" ? view.message : "", /^fatal: bad config line \d+ in file /);
  assert.equal(view.kind === "error" ? view.broken_gitfile : true, false);
});

test("stderr classes: not a repository, dubious ownership, bare, corrupt index and unknown text", async () => {
  const root = await scratch("repo-classes");
  assert.deepEqual(await classify_detect_failure("fatal: not a git repository (or any of the parent directories): .git\n", root), { kind: "none" });
  assert.deepEqual(
    await classify_detect_failure("fatal: detected dubious ownership in repository at 'D:/shared/repo'\n'D:/shared/repo' is owned by:\n\tBUILTIN/Administrators\n", root),
    { kind: "ownership", path: "D:/shared/repo" },
  );
  assert.deepEqual(await classify_detect_failure("fatal: this operation must be run in a work tree\n", root), { kind: "none" });
  assert.deepEqual(await classify_detect_failure("warning: x\nerror: bad signature 0x00000000\nfatal: index file corrupt\n", root), { kind: "error", message: "error: bad signature 0x00000000", broken_gitfile: false });
  assert.deepEqual(await classify_detect_failure("fatal: not a git repository: D:/x/missing\n", root), { kind: "error", message: "fatal: not a git repository: D:/x/missing", broken_gitfile: false });
  assert.deepEqual(await classify_detect_failure("fatal: unable to access 'https://user:tok@github.com/o/r/'\n", root), { kind: "error", message: "fatal: unable to access 'https://github.com/o/r/'", broken_gitfile: false });
});
