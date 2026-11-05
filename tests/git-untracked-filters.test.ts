import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { before, test } from "node:test";
import { collect_change_text } from "../electron/git/change-text.ts";
import { guard_from, read_guard } from "../electron/git/guard.ts";
import { detect_repo } from "../electron/git/repo.ts";
import { exec_git } from "../electron/git/run.ts";
import { create_git_session } from "../electron/git/session.ts";
import { default_readers } from "../electron/git/readers.ts";
import type { GitView } from "../shared/git-view.ts";
import { reflow_message } from "../shared/git/message.ts";
import { create_worktree } from "../electron/worktrees/create.ts";
import { sweep_worktree_ledger } from "../electron/worktrees/sweep.ts";
import { ledger_entries } from "../electron/worktrees/ledger.ts";
import { git, git_status, quiet_fetcher, quiet_window, repo_with, scratch, skip_without_git, tool, write } from "./git-kit.ts";
import { access_of, identity_config } from "./git-write-kit.ts";
import { project_repo, worktree_env } from "./worktree-kit.ts";

let global = "";
before(async () => { if (!skip_without_git) { global = await identity_config(); await worktree_env(); } });

test("untracked symlinks do not expose external target contents", { skip: skip_without_git }, async (t) => {
  const root = await repo_with("symlink", { "readme.txt": "base" });
  const external = await scratch("private");
  await write(external, { "private.txt": "EXTERNAL_PRIVATE_CONTENT" });
  try { await fs.symlink(path.join(external, "private.txt"), path.join(root, "linked.txt"), "file"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") { t.skip("File symlink creation requires a Windows privilege not available here; directory junction case remains real."); return; } throw error; }
  const text = await collect_change_text(await access_of(root), { kind: "working" }, 100000);
  assert.ok(text.includes("linked.txt"));
  assert.ok(!text.includes("EXTERNAL_PRIVATE_CONTENT"), text);
});

test("untracked files beneath directory links stay inside the project boundary", { skip: skip_without_git }, async () => {
  const root = await repo_with("junction", { "readme.txt": "base" });
  const external = await scratch("junction-private");
  await write(external, { "private.txt": "JUNCTION_PRIVATE_CONTENT" });
  await fs.symlink(external, path.join(root, "linked"), "junction");
  const text = await collect_change_text(await access_of(root), { kind: "working" }, 100000);
  assert.ok(!text.includes("JUNCTION_PRIVATE_CONTENT"), text);
});

test("submodule filters cannot disable trusted global filters in the parent", { skip: skip_without_git }, async () => {
  const source = await repo_with("filter-source", { "sub.txt": "sub" });
  const root = await repo_with("filter-parent", { ".gitattributes": "*.txt filter=lfs\n", "parent.txt": "working\n" });
  git(root, "submodule", "add", "-q", source, "sub");
  git(root, "commit", "-qm", "add submodule");
  const config = path.join(root, ".git", "modules", "sub", "config");
  git(root, "config", "--file", config, "filter.lfs.clean", "untrusted-submodule-program");
  const original = await fs.readFile(global, "utf8");
  try {
    await fs.appendFile(global, '\n[filter "lfs"]\n\tclean = sed s/working/stored/g\n');
    const detected = await detect_repo(tool(), root);
    assert.equal(detected.kind, "repo");
    if (detected.kind !== "repo") return;
    const guard = await read_guard(tool(), detected.paths, null);
    const expected = git(root, "hash-object", "--path=parent.txt", "parent.txt").trim();
    const output = await exec_git(tool(), { cwd: root, args: ["hash-object", "--path=parent.txt", "parent.txt"], config: guard.read_config });
    assert.equal(output.code, 0, output.stderr);
    assert.equal(output.stdout.toString().trim(), expected, JSON.stringify(guard.read_config));
    assert.equal(guard.read_config.find(([key]) => key === "filter.lfs.clean")?.[1], "sed s/working/stored/g");
  } finally { await fs.writeFile(global, original); }
});

test("detection exceptions publish an error instead of retaining loading and can recover", { skip: skip_without_git }, async () => {
  const root = await repo_with("detect", { "file.txt": "base" });
  const views: GitView[] = [];
  let reject = () => {};
  let fail = true;
  const held = new Promise<never>((_resolve, rejection) => { reject = () => rejection(new Error("medium detect failure")); });
  const session = create_git_session({ path: root, name: "test", kind: "project" }, { readers: { ...default_readers, tool: async () => ({ kind: "found", tool: tool(), stamp: null }), detect: (...args) => fail ? held : default_readers.detect(...args) }, window: quiet_window, fetcher: quiet_fetcher, publish: (_root, view) => { views.push(view); } });
  const settle = async (predicate: () => boolean) => { for (let i = 0; i < 200 && !predicate(); i++) await new Promise((resolve) => setTimeout(resolve, 5)); };
  try {
    await settle(() => views.some((view) => view.kind === "loading"));
    reject();
    await settle(() => views.at(-1)?.kind === "error");
    assert.equal(views.at(-1)?.kind, "error");
    assert.match(views.at(-1)?.kind === "error" ? (views.at(-1) as Extract<GitView, {kind:"error"}>).message : "", /medium detect failure/);
    fail = false;
    session.refresh();
    await settle(() => views.at(-1)?.kind === "repo");
    assert.equal(views.at(-1)?.kind, "repo");
  } finally { session.stop(); }
});

test("unfinished creating worktrees do not leave their reserved branch", { skip: skip_without_git }, async () => {
  const root = await project_repo("creating");
  const worktree = await create_worktree(root, root, "unfinished branch");
  assert.equal((await ledger_entries()).find((entry) => entry.path === worktree.path)?.state, "creating");
  assert.equal(git_status(root, "rev-parse", "--verify", `refs/heads/${worktree.branch}`), 0);
  await sweep_worktree_ledger();
  assert.notEqual(git_status(root, "rev-parse", "--verify", `refs/heads/${worktree.branch}`), 0);
});

test("trailer records keep their own lines while ordinary prose still reflows", () => {
  const source = "Subject\n\nWrapped prose\ncontinues here.\n\nSigned-off-by: Person <person@example.invalid>\nReviewed-by: Reviewer <reviewer@example.invalid>\nFixes: #123";
  assert.equal(reflow_message(source), "Subject\n\nWrapped prose continues here.\n\nSigned-off-by: Person <person@example.invalid>\nReviewed-by: Reviewer <reviewer@example.invalid>\nFixes: #123");
});

test("compact trailers and indented continuation remain separate from prose", () => {
  assert.equal(reflow_message("Subject\n\nReviewed-by:A\nSigned-off-by:B\n  continuation\nFixes:#123"), "Subject\n\nReviewed-by:A\nSigned-off-by:B\n  continuation\nFixes:#123");
  assert.equal(reflow_message("Note: a long paragraph\ncontinues normally."), "Note: a long paragraph continues normally.");
});

test("cleanup preserves a branch another registered worktree still owns", { skip: skip_without_git }, async () => {
  const root = await project_repo("other-owner");
  const worktree = await create_worktree(root, root, "other owner");
  const other = path.join(await scratch("foreign-tree"), "tree");
  git(root, "worktree", "add", "--force", other, worktree.branch);
  await sweep_worktree_ledger();
  assert.equal(git_status(root, "rev-parse", "--verify", `refs/heads/${worktree.branch}`), 0);
  assert.equal(git(other, "symbolic-ref", "--short", "HEAD").trim(), worktree.branch);
});

test("a junction replacing an initially local directory is checked again before reading", { skip: skip_without_git }, async (t) => {
  const root = await repo_with("link-swap", { "readme.txt": "base" });
  const external = await scratch("link-swap-private");
  await write(root, { "local/file.txt": "normal" });
  await write(external, { "file.txt": "LATE_EXTERNAL_CONTENT" });
  const access = await access_of(root);
  const stat = fs.stat.bind(fs);
  let swapped = false;
  t.mock.method(fs, "stat", async (file: Parameters<typeof fs.stat>[0], ...args: unknown[]) => {
    const info = await Reflect.apply(stat, fs, [file, ...args]);
    if (!swapped && String(file) === path.join(root, "local", "file.txt")) {
      swapped = true;
      await fs.rm(path.join(root, "local"), { recursive: true });
      await fs.symlink(external, path.join(root, "local"), "junction");
    }
    return info;
  });
  const text = await collect_change_text(access, { kind: "working" }, 100000);
  assert.equal(swapped, true);
  assert.ok(!text.includes("LATE_EXTERNAL_CONTENT"), text);
});

test("trusted LFS process and required settings override untrusted submodule definitions", () => {
  const trusted = [
    { scope: "global", key: "filter.lfs.clean", value: "git-lfs clean -- %f" },
    { scope: "global", key: "filter.lfs.process", value: "git-lfs filter-process" },
    { scope: "global", key: "filter.lfs.required", value: null },
  ];
  const owned = [
    { scope: "local", key: "filter.lfs.clean", value: "untrusted-clean" },
    { scope: "local", key: "filter.lfs.process", value: "untrusted-process" },
    { scope: "local", key: "filter.lfs.required", value: "false" },
  ];
  assert.deepEqual(guard_from(trusted, owned).read_config, [["filter.lfs.clean", "git-lfs clean -- %f"], ["filter.lfs.process", "git-lfs filter-process"], ["filter.lfs.required", "true"]]);
});

test("conditional submodule guards preserve parent clean-only filters and block child programs under bracket paths", { skip: skip_without_git }, async () => {
  const root = path.join(await scratch("conditional"), "[scope]");
  await fs.mkdir(root);
  git(root, "init", "-q", "-b", "main");
  await write(root, { ".gitattributes": "*.txt filter=lfs\n", "parent.txt": "working\n" });
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  const source = await repo_with("conditional-child", { ".gitattributes": "*.txt filter=lfs\n", "child.txt": "working\n" });
  git(root, "submodule", "add", "-q", source, "sub");
  git(root, "commit", "-qam", "submodule");
  const marker = path.join(root, "blocked-marker");
  git(root, "config", "--file", path.join(root, ".git", "modules", "sub", "config"), "filter.lfs.process", `sh -c 'echo bad > "${marker.replaceAll("\\", "/")}"; exit 1'`);
  const original = await fs.readFile(global, "utf8");
  try {
    await fs.appendFile(global, '\n[filter "lfs"]\n\tclean = sed s/working/stored/g\n');
    const detected = await detect_repo(tool(), root);
    assert.equal(detected.kind, "repo");
    if (detected.kind !== "repo") return;
    const guard = await read_guard(tool(), detected.paths, null);
    const expected = git(root, "hash-object", "--path=parent.txt", "parent.txt").trim();
    const actual = await exec_git(tool(), { cwd: root, args: ["hash-object", "--path=parent.txt", "parent.txt"], config: guard.read_config });
    assert.equal(actual.stdout.toString().trim(), expected);
    const future = new Date(Date.now() + 10000);
    await fs.utimes(path.join(root, "sub", "child.txt"), future, future);
    const status = await exec_git(tool(), { cwd: root, args: ["status", "--porcelain=v2"], config: guard.read_config });
    assert.equal(status.code, 0, status.stderr);
    assert.equal(await fs.access(marker).then(() => true, () => false), false);
  } finally { await fs.writeFile(global, original); }
});
