import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fetch_blocked, fetch_call } from "../electron/git/fetch.ts";
import { fetch_block, guard_from, read_guard, type ConfigEntry } from "../electron/git/guard.ts";
import { detect_repo } from "../electron/git/repo.ts";
import { exec_git } from "../electron/git/run.ts";
import { run_status } from "../electron/git/status.ts";
import { cloned_pair, fetch_rig, ref_of, target_of } from "./git-fetch-kit.ts";
import { first_view, git, marker, posix, repo_with, skip_without_git, tool, touch_future, write } from "./git-kit.ts";

const options = { skip: skip_without_git };

const repo_paths = async (root: string) => {
  const detected = await detect_repo(tool(), root);
  if (detected.kind !== "repo") throw new Error(`${root} is not a repository: ${JSON.stringify(detected)}`);
  return detected.paths;
};

const guarded_status = async (root: string) => {
  const guard = await read_guard(tool(), await repo_paths(root), null);
  await run_status(tool(), root, guard.read_config);
  return guard;
};

const guarded_diff = async (root: string) => {
  const guard = await read_guard(tool(), await repo_paths(root), null);
  await exec_git(tool(), { cwd: root, args: ["diff", "HEAD", "--no-ext-diff", "--no-textconv", "--no-color"], config: guard.read_config });
};

const plain_status = (root: string) => git(root, "status", "--porcelain=v2");

const hook_script = async (dir: string, marker: string): Promise<string> => {
  const file = path.join(dir, "hook.sh");
  await fs.writeFile(file, `#!/bin/sh\necho ran >> '${marker}'\n`);
  return posix(file);
};

const filter_command = (marker: string) => `sh -c 'echo ran >> "${marker}"; cat'`;

test("a local clean filter runs for a plain status and diff but never through the guarded reads", options, async () => {
  const root = await repo_with("guard-filter", { ".gitattributes": "*.txt filter=mark\n", "a.txt": "a\n" });
  const mark = await marker();
  git(root, "config", "filter.mark.clean", filter_command(mark.file));
  await touch_future(path.join(root, "a.txt"));
  const guard = await guarded_status(root);
  await guarded_diff(root);
  assert.equal(await mark.ran(), false);
  assert.deepEqual(guard.read_config, [["filter.mark.clean", ""], ["filter.mark.process", ""], ["filter.mark.required", "false"]]);
  plain_status(root);
  assert.equal(await mark.ran(), true);
});

test("a filter name with an equals sign is neutralised as well", options, async () => {
  const root = await repo_with("guard-equals", { ".gitattributes": "*.txt filter=x=y\n", "a.txt": "a\n" });
  const mark = await marker();
  git(root, "config", "filter.x=y.clean", filter_command(mark.file));
  await touch_future(path.join(root, "a.txt"));
  await guarded_status(root);
  assert.equal(await mark.ran(), false);
  plain_status(root);
  assert.equal(await mark.ran(), true);
});

test("a local process filter never starts through the guarded status", options, async () => {
  const root = await repo_with("guard-process", { ".gitattributes": "*.dat filter=proc\n", "a.dat": "a\n" });
  const mark = await marker();
  git(root, "config", "filter.proc.process", `sh -c 'echo ran >> "${mark.file}"; exit 1'`);
  await touch_future(path.join(root, "a.dat"));
  await guarded_status(root);
  assert.equal(await mark.ran(), false);
  try {
    plain_status(root);
  } catch (error) {
    console.info(`[test] the plain status with a failing process filter exited non-zero, which is expected: ${String(error).split("\n")[0]}`);
  }
  assert.equal(await mark.ran(), true);
});

test("a local fsmonitor hook never runs through the guarded status, a boolean fsmonitor stays", options, async () => {
  const root = await repo_with("guard-fsmonitor", { "a.txt": "a\n" });
  const mark = await marker();
  git(root, "config", "core.fsmonitor", await hook_script(mark.dir, mark.file));
  const guard = await guarded_status(root);
  assert.deepEqual(guard.read_config, [["core.fsmonitor", "false"]]);
  assert.equal(await mark.ran(), false);
  plain_status(root);
  assert.equal(await mark.ran(), true);
  git(root, "config", "core.fsmonitor", "true");
  assert.deepEqual((await read_guard(tool(), await repo_paths(root), null)).read_config, []);
});

test("hooks never run through the runner, here the reference-transaction hook on a ref update", options, async () => {
  const root = await repo_with("guard-hook", { "a.txt": "a\n" });
  const mark = await marker();
  await fs.writeFile(path.join(root, ".git", "hooks", "reference-transaction"), `#!/bin/sh\necho ran >> '${mark.file}'\n`);
  const output = await exec_git(tool(), { cwd: root, args: ["update-ref", "refs/heads/guarded", "HEAD"] });
  assert.equal(output.code, 0, output.stderr);
  assert.equal(await mark.ran(), false);
  git(root, "update-ref", "refs/heads/plain", "HEAD");
  assert.equal(await mark.ran(), true);
});

const with_submodule = async (prefix: string, files: Record<string, string>) => {
  const sub = await repo_with(`${prefix}-src`, files);
  const parent = await repo_with(prefix, { "README.md": "r\n" });
  git(parent, "submodule", "add", "-q", sub, "libs/ops");
  git(parent, "commit", "-q", "-m", "add submodule");
  return { parent, module_config: path.join(parent, ".git", "modules", "libs", "ops", "config"), work_tree: path.join(parent, "libs", "ops") };
};

test("an fsmonitor hook in a submodule config never runs through the superproject status", options, async () => {
  const { parent, module_config } = await with_submodule("guard-subfsm", { "lib.txt": "x\n" });
  const mark = await marker();
  git(parent, "config", "--file", module_config, "core.fsmonitor", await hook_script(mark.dir, mark.file));
  const guard = await guarded_status(parent);
  assert.deepEqual(guard.read_config, [["core.fsmonitor", "false"]]);
  assert.equal(await mark.ran(), false);
  plain_status(parent);
  assert.equal(await mark.ran(), true);
});

test("a filter in a submodule config never runs through the superproject status or diff", options, async () => {
  const { parent, module_config, work_tree } = await with_submodule("guard-subfilter", { ".gitattributes": "*.txt filter=mark\n", "lib.txt": "x\n" });
  const mark = await marker();
  git(parent, "config", "--file", module_config, "filter.mark.clean", filter_command(mark.file));
  await touch_future(path.join(work_tree, "lib.txt"));
  await guarded_status(parent);
  await guarded_diff(parent);
  assert.equal(await mark.ran(), false);
  plain_status(parent);
  assert.equal(await mark.ran(), true);
});

test("an fsmonitor hook in the superproject never runs when a submodule project is detected (G21)", options, async () => {
  const { parent, work_tree } = await with_submodule("guard-superfsm", { "lib.txt": "x\n" });
  const mark = await marker();
  git(parent, "config", "core.fsmonitor", await hook_script(mark.dir, mark.file));
  const detected = await detect_repo(tool(), work_tree);
  assert.equal(detected.kind === "repo" ? detected.paths.superproject : null, posix(parent));
  assert.equal(await mark.ran(), false);
  git(work_tree, "rev-parse", "--show-superproject-working-tree");
  assert.equal(await mark.ran(), true);
});

test("an embedded repository added as a gitlink has its config read from its own .git folder", options, async () => {
  const parent = await repo_with("guard-embedded", { "README.md": "r\n" });
  const inner = path.join(parent, "inner");
  await fs.mkdir(inner);
  git(inner, "init", "-q", "-b", "main");
  await write(inner, { "x.txt": "x\n" });
  git(inner, "add", "x.txt");
  git(inner, "commit", "-q", "-m", "inner");
  git(parent, "add", "inner");
  git(parent, "commit", "-q", "-m", "embedded");
  const mark = await marker();
  git(inner, "config", "core.fsmonitor", await hook_script(mark.dir, mark.file));
  await guarded_status(parent);
  assert.equal(await mark.ran(), false);
  plain_status(parent);
  assert.equal(await mark.ran(), true);
});

test("a partial clone is not read with a git older than 2.45 (G3)", options, async () => {
  const root = await repo_with("guard-partial", { "a.txt": "a\n" });
  git(root, "config", "remote.origin.promisor", "true");
  const old = { ...tool(), version: "2.44.0", numbers: [2, 44, 0] as [number, number, number] };
  const view = await first_view(root, "project", { tool: async () => ({ kind: "found", tool: old, stamp: null }) });
  assert.deepEqual(view, { kind: "git_too_old", version: "2.44.0", reason: "partial_clone" });
  const current = await first_view(root);
  assert.equal(current.kind, "repo");
});

test("a program-starting key from an included local file blocks fetching and names the key", options, async () => {
  const root = await repo_with("guard-include", { "a.txt": "a\n" });
  await fs.writeFile(path.join(root, ".git", "extra.cfg"), "[core]\n\tsshCommand = evil-ssh\n");
  git(root, "config", "include.path", "extra.cfg");
  const guard = await read_guard(tool(), await repo_paths(root), null);
  assert.deepEqual(fetch_block(guard, "origin"), { kind: "repo_config", keys: ["core.sshCommand"] });
});

const entry = (scope: string, key: string, value: string | null): ConfigEntry => ({ scope, key, value });

test("only local and submodule values count, and booleans keep the built-in fsmonitor", () => {
  assert.deepEqual(guard_from([entry("global", "core.fsmonitor", "true"), entry("global", "filter.lfs.clean", "git-lfs clean -- %f")], []).read_config, []);
  assert.deepEqual(guard_from([entry("local", "core.fsmonitor", "yes"), entry("local", "core.fsmonitor", null)], []).read_config, []);
  assert.deepEqual(guard_from([entry("global", "core.fsmonitor", "C:/hook.sh")], []).read_config, []);
  assert.deepEqual(guard_from([entry("worktree", "core.fsmonitor", "C:/hook.sh")], []).read_config, [["core.fsmonitor", "false"]]);
  assert.deepEqual(guard_from([], [entry("local", "filter.My.Name.clean", "x")]).read_config, [["filter.My.Name.clean", ""], ["filter.My.Name.process", ""], ["filter.My.Name.required", "false"]]);
});

test("fetch blocks: program keys, refspecs writing local branches and mirror remotes", () => {
  const keys = guard_from(
    [entry("local", "credential.https://example.org.helper", "store"), entry("local", "protocol.ext.allow", "always"), entry("local", "remote.origin.uploadpack", "x"), entry("global", "core.sshcommand", "ok")],
    [],
  );
  assert.deepEqual(fetch_block(keys, "origin"), { kind: "repo_config", keys: ["credential.https://example.org.helper", "protocol.ext.allow", "remote.origin.uploadpack"] });
  const normal = guard_from([entry("local", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"), entry("local", "remote.origin.fetch", "^refs/heads/skip"), entry("local", "remote.origin.fetch", "refs/tags/*:refs/tags/*")], []);
  assert.equal(fetch_block(normal, "origin"), null);
  const heads = guard_from([entry("local", "remote.origin.fetch", "+refs/heads/*:refs/heads/*")], []);
  assert.deepEqual(fetch_block(heads, "origin"), { kind: "local_refspec", key: "remote.origin.fetch" });
  assert.equal(fetch_block(heads, "public"), null);
  const mirror = guard_from([entry("local", "remote.origin.mirror", "true")], []);
  assert.deepEqual(fetch_block(mirror, "origin"), { kind: "local_refspec", key: "remote.origin.mirror" });
  assert.equal(guard_from([entry("local", "extensions.partialclone", "origin")], []).partial_clone, true);
});

test("the guard is read again before a read: an unchanged index keeps its gitlink list, a new gitlink with its own config is picked up", options, async () => {
  const parent = await repo_with("guard-stale", { "README.md": "r\n" });
  const paths = await repo_paths(parent);
  const first = await read_guard(tool(), paths, null);
  assert.equal((await read_guard(tool(), paths, first)).trees[0], first.trees[0]);
  await write(parent, { "README.md": "changed\n" });
  git(parent, "add", "README.md");
  const index_only = await read_guard(tool(), paths, first);
  assert.notEqual(index_only.trees[0], first.trees[0]);
  assert.deepEqual(index_only.trees[0]?.links, []);
  assert.deepEqual(index_only.read_config, []);
  const inner = path.join(parent, "inner");
  await fs.mkdir(inner);
  git(inner, "init", "-q", "-b", "main");
  await write(inner, { "x.txt": "x\n" });
  git(inner, "add", "x.txt");
  git(inner, "commit", "-q", "-m", "inner");
  const mark = await marker();
  git(inner, "config", "core.fsmonitor", await hook_script(mark.dir, mark.file));
  git(parent, "add", "inner");
  const fresh = await read_guard(tool(), paths, index_only);
  assert.deepEqual(fresh.read_config, [["core.fsmonitor", "false"]]);
  await run_status(tool(), parent, fresh.read_config);
  assert.equal(await mark.ran(), false);
  git(inner, "config", "filter.late.clean", "cat");
  assert.deepEqual((await read_guard(tool(), paths, fresh)).read_config.map(([key]) => key), ["core.fsmonitor", "filter.late.clean", "filter.late.process", "filter.late.required"]);
});

test("a value from an included file in the work tree is picked up when only that file changes", options, async () => {
  const root = await repo_with("guard-include-tree", { "a.txt": "a\n" });
  await write(root, { "inc.cfg": "" });
  git(root, "config", "include.path", "../inc.cfg");
  const paths = await repo_paths(root);
  const first = await read_guard(tool(), paths, null);
  assert.deepEqual(first.read_config, []);
  const mark = await marker();
  git(root, "config", "--file", path.join(root, "inc.cfg"), "core.fsmonitor", await hook_script(mark.dir, mark.file));
  const next = await read_guard(tool(), paths, first);
  assert.deepEqual(next.read_config, [["core.fsmonitor", "false"]]);
  await run_status(tool(), root, next.read_config);
  assert.equal(await mark.ran(), false);
  plain_status(root);
  assert.equal(await mark.ran(), true);
});

test("a value behind includeIf onbranch is picked up after a checkout", options, async () => {
  const root = await repo_with("guard-onbranch", { "a.txt": "a\n" });
  git(root, "branch", "feature");
  const mark = await marker();
  const included = path.join(mark.dir, "branch.cfg");
  git(root, "config", "--file", included, "core.fsmonitor", await hook_script(mark.dir, mark.file));
  git(root, "config", "includeIf.onbranch:feature.path", posix(included));
  const paths = await repo_paths(root);
  const first = await read_guard(tool(), paths, null);
  assert.deepEqual(first.read_config, []);
  git(root, "checkout", "-q", "feature");
  await fs.rm(mark.file, { force: true });
  const next = await read_guard(tool(), paths, first);
  assert.deepEqual(next.read_config, [["core.fsmonitor", "false"]]);
  await run_status(tool(), root, next.read_config);
  assert.equal(await mark.ran(), false);
  plain_status(root);
  assert.equal(await mark.ran(), true);
});

test("a submodule value behind includeIf is read in the submodule's own context, not the superproject's", options, async () => {
  const { parent, module_config } = await with_submodule("guard-subif", { "lib.txt": "x\n" });
  git(parent, "checkout", "-q", "-b", "other");
  const mark = await marker();
  const included = path.join(mark.dir, "sub.cfg");
  git(parent, "config", "--file", included, "core.fsmonitor", await hook_script(mark.dir, mark.file));
  git(parent, "config", "--file", module_config, "includeIf.onbranch:main.path", posix(included));
  const guard = await guarded_status(parent);
  assert.deepEqual(guard.read_config, [["core.fsmonitor", "false"]]);
  assert.equal(await mark.ran(), false);
  plain_status(parent);
  assert.equal(await mark.ran(), true);
});

const untouched = { at: null, running: false, error: null, paused: false, queued: false };

test("fetch cases: a reference-transaction hook never runs through the app's fetch", options, async () => {
  const pair = await cloned_pair("guard-fetch-hook");
  await pair.push("second");
  const mark = await marker();
  await fs.writeFile(path.join(pair.local, ".git", "hooks", "reference-transaction"), `#!/bin/sh\necho ran >> '${mark.file}'\n`);
  const output = await exec_git(tool(), fetch_call(await target_of(pair.local)));
  assert.equal(output.code, 0, output.stderr);
  assert.equal(await mark.ran(), false);
  await pair.push("third");
  git(pair.local, "fetch", "-q", "origin");
  assert.equal(await mark.ran(), true);
});

test("fetch cases: core.alternateRefsCommand with the repository's own alternates blocks fetching and never runs", options, async () => {
  const pair = await cloned_pair("guard-alternates");
  await pair.push("second");
  const mark = await marker();
  await fs.writeFile(path.join(pair.local, ".git", "objects", "info", "alternates"), `${posix(path.join(pair.bare, "objects"))}\n`);
  git(pair.local, "config", "core.alternateRefsCommand", await hook_script(mark.dir, mark.file));
  const rig = fetch_rig();
  const target = await target_of(pair.local);
  assert.deepEqual(fetch_blocked(target), { kind: "repo_config", keys: ["core.alternateRefsCommand"] });
  rig.fetcher.request(target, "refresh");
  rig.fetcher.request(target, "open");
  assert.deepEqual(rig.fetcher.status(target.common_dir, "origin"), untouched);
  assert.equal(await mark.ran(), false);
  git(pair.local, "fetch", "-q", "origin");
  assert.equal(await mark.ran(), true);
});

test("fetch cases: a refspec into refs/heads or a mirror remote blocks fetching and a local-only commit stays on its branch", options, async () => {
  const pair = await cloned_pair("guard-refspec");
  git(pair.local, "commit", "-q", "--allow-empty", "-m", "local only");
  const local_only = ref_of(pair.local, "refs/heads/main");
  git(pair.local, "checkout", "-q", "-b", "work");
  const pushed = await pair.push("second");
  git(pair.local, "config", "--replace-all", "remote.origin.fetch", "+refs/heads/*:refs/heads/*");
  const rig = fetch_rig();
  const heads = await target_of(pair.local);
  assert.deepEqual(fetch_blocked(heads), { kind: "local_refspec", key: "remote.origin.fetch" });
  rig.fetcher.request(heads, "refresh");
  assert.deepEqual(rig.fetcher.status(heads.common_dir, "origin"), untouched);
  assert.equal(ref_of(pair.local, "refs/heads/main"), local_only);
  git(pair.local, "config", "--replace-all", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*");
  git(pair.local, "config", "remote.origin.mirror", "true");
  assert.deepEqual(fetch_blocked(await target_of(pair.local)), { kind: "local_refspec", key: "remote.origin.mirror" });
  git(pair.local, "config", "--unset", "remote.origin.mirror");
  git(pair.local, "config", "--replace-all", "remote.origin.fetch", "+refs/heads/*:refs/heads/*");
  git(pair.local, "fetch", "-q", "origin");
  assert.equal(ref_of(pair.local, "refs/heads/main"), pushed);
});
