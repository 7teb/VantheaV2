import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { before, test, type TestContext } from "node:test";
import { delete_chat } from "../electron/chats/store.ts";
import { storage_paths } from "../electron/storage/paths.ts";
import { create_worktree, create_worktree_chat } from "../electron/worktrees/create.ts";
import { ledger_add, ledger_entries } from "../electron/worktrees/ledger.ts";
import { sweep_worktree_ledger } from "../electron/worktrees/sweep.ts";
import { git, skip_without_git } from "./git-kit.ts";
import { exists, project_repo, worktree_env, type WorktreeEnv } from "./worktree-kit.ts";

let env: WorktreeEnv;

before(async () => {
  if (!skip_without_git) env = await worktree_env();
});

const worktree_count = (project: string) => git(project, "worktree", "list", "--porcelain").match(/^worktree /gm)?.length ?? 0;

test("a corrupt ledger is kept aside and the ledger starts empty", { skip: skip_without_git }, async (t: TestContext) => {
  const logged = t.mock.method(console, "error", () => {});
  await fs.writeFile(storage_paths().worktree_ledger, "{ not json");
  assert.deepEqual(await ledger_entries(), []);
  const kept = (await fs.readdir(env.worktrees)).filter((name) => name.startsWith("ledger.json.corrupt-"));
  assert.equal(kept.length, 1);
  assert.equal(await fs.readFile(path.join(env.worktrees, kept[0] ?? ""), "utf8"), "{ not json");
  assert.match(String(logged.mock.calls[0]?.arguments[0]), /worktree ledger .* is corrupt/);
  assert.deepEqual(JSON.parse(await fs.readFile(storage_paths().worktree_ledger, "utf8")), { version: 1, entries: [] });
});

test("the next start finishes a removal and a creation that a quit interrupted", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-restart");
  const removed = await create_worktree_chat(project, "removal interrupted");
  await delete_chat(removed.id);
  const removed_path = removed.worktree?.path ?? "";
  await ledger_add({ path: removed_path, project_path: project, state: "removing", at: new Date().toISOString() });
  const created = await create_worktree(project, project, "creation interrupted");
  assert.equal(worktree_count(project), 3);
  assert.deepEqual((await ledger_entries()).map((entry) => entry.state), ["removing", "creating"]);
  await sweep_worktree_ledger();
  assert.equal(await exists(path.dirname(removed_path)), false);
  assert.equal(await exists(path.dirname(created.path)), false);
  assert.equal(worktree_count(project), 1);
  assert.deepEqual(await ledger_entries(), []);
});

test("an entry whose chat exists is dropped without touching the folder", { skip: skip_without_git }, async () => {
  const project = await project_repo("wt-finished");
  const meta = await create_worktree_chat(project, "finished creation");
  const tree = meta.worktree?.path ?? "";
  await ledger_add({ path: tree, project_path: project, state: "creating", at: new Date().toISOString() });
  await sweep_worktree_ledger();
  assert.equal(await exists(tree), true);
  assert.deepEqual(await ledger_entries(), []);
});

test("a folder that no chat and no ledger entry names is left alone and reported", { skip: skip_without_git }, async (t: TestContext) => {
  const warned = t.mock.method(console, "warn", () => {});
  const stray = path.join(env.worktrees, "0123abcd", "stray");
  await fs.mkdir(stray, { recursive: true });
  await fs.writeFile(path.join(stray, "work.txt"), "keep me");
  await sweep_worktree_ledger();
  assert.equal(await fs.readFile(path.join(stray, "work.txt"), "utf8"), "keep me");
  assert.ok(warned.mock.calls.some((call) => String(call.arguments[0]).includes(path.dirname(stray))));
});

test("a ledger entry outside the worktree folder is dropped and nothing is deleted", { skip: skip_without_git }, async (t: TestContext) => {
  const logged = t.mock.method(console, "error", () => {});
  const outside = path.join(env.root, "outside", "keep");
  await fs.mkdir(outside, { recursive: true });
  await ledger_add({ path: outside, project_path: "", state: "removing", at: new Date().toISOString() });
  await sweep_worktree_ledger();
  assert.equal(await exists(outside), true);
  assert.deepEqual(await ledger_entries(), []);
  assert.match(String(logged.mock.calls[0]?.arguments[0]), /outside the worktree folder/);
});
