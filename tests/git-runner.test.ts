import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { base_flags, exec_git, git_env, git_ok } from "../electron/git/run.ts";
import { run_status } from "../electron/git/status.ts";
import { git, marker, repo_with, scratch, skip_without_git, tool, touch_future, write } from "./git-kit.ts";

const options = { skip: skip_without_git };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the runner starts git.exe by absolute path, never a git program in the project folder", options, async () => {
  const project = await scratch("runner-cwd");
  const mark = await marker();
  await write(project, { "git.exe": "not a program", "git.cmd": `@echo ran> "${mark.file}"\r\n`, "git.bat": `@echo ran> "${mark.file}"\r\n` });
  assert.ok(path.isAbsolute(tool().exe));
  const output = await exec_git(tool(), { cwd: project, args: ["--version"] });
  assert.equal(output.code, 0, output.stderr);
  assert.match(output.stdout.toString("utf8"), /^git version /);
  assert.equal(await mark.ran(), false);
});

test("the environment drops repository variables, disables prompts and optional locks, and carries config pairs", () => {
  const env = git_env({ GIT_DIR: "C:/elsewhere", git_work_tree: "x", Path: "C:/bin", GIT_ASKPASS: "C:/askpass.exe", lc_all: "de_DE", GIT_CONFIG_KEY_7: "core.pager", GIT_CONFIG_VALUE_7: "evil" }, ["GIT_DIR", "GIT_WORK_TREE", "GIT_CONFIG_COUNT"], [["filter.a=b.clean", ""]]);
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.git_work_tree, undefined);
  assert.equal(env.lc_all, undefined);
  assert.equal(env.GIT_CONFIG_KEY_7, undefined);
  assert.equal(env.Path, "C:/bin");
  assert.equal(env.GIT_ASKPASS, "");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(env.GIT_OPTIONAL_LOCKS, "0");
  assert.equal(env.GCM_INTERACTIVE, "never");
  assert.equal(env.LC_ALL, "C");
  assert.equal(env.GIT_NO_LAZY_FETCH, "1");
  assert.equal(env.GIT_CONFIG_COUNT, "1");
  assert.equal(env.GIT_CONFIG_KEY_0, "filter.a=b.clean");
  assert.equal(env.GIT_CONFIG_VALUE_0, "");
  assert.deepEqual(base_flags, ["-c", "core.hooksPath=NUL", "-c", "safe.bareRepository=explicit"]);
});

test("aborting a call rejects with the reason and ends the process tree", options, async () => {
  const root = await scratch("runner-abort");
  const mark = await marker();
  const controller = new AbortController();
  const started = Date.now();
  const call = exec_git(tool(), { cwd: root, args: ["-c", `alias.slow=!sleep 3 && echo ran > '${mark.file}'`, "slow"], signal: controller.signal });
  setTimeout(() => controller.abort(new Error("the panel closed")), 300);
  await assert.rejects(call, /the panel closed/);
  assert.ok(Date.now() - started < 3000);
  await sleep(4000);
  assert.equal(await mark.ran(), false);
});

test("large output is collected whole, there is no buffer limit", options, async () => {
  const big = "0123456789abcdef".repeat(512 * 1024);
  const root = await repo_with("runner-big", { "big.txt": big });
  const output = git_ok(await exec_git(tool(), { cwd: root, args: ["cat-file", "-p", "HEAD:big.txt"] }), "git cat-file");
  assert.equal(output.length, big.length);
});

test("a failing call reports its exit code and git's error line without userinfo", options, async () => {
  const root = await scratch("runner-fail");
  const output = await exec_git(tool(), { cwd: root, args: ["log"] });
  assert.notEqual(output.code, 0);
  assert.throws(() => git_ok(output, "git log"), (error: Error & { git_line?: string }) => /^fatal: not a git repository/.test(error.git_line ?? ""));
});

test("the status read leaves the index untouched even when files look changed", options, async () => {
  const root = await repo_with("runner-index", { "a.txt": "a\n" });
  git(root, "status");
  const index = path.join(root, ".git", "index");
  await touch_future(path.join(root, "a.txt"));
  const before = (await fs.stat(index, { bigint: true })).mtimeNs;
  await run_status(tool(), root, []);
  await run_status(tool(), root, []);
  assert.equal((await fs.stat(index, { bigint: true })).mtimeNs, before);
});
