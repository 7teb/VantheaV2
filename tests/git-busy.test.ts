import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { create_repo_busy, type WorkSources } from "../electron/git/busy.ts";
import { git, repo_with, scratch, skip_without_git } from "./git-kit.ts";

const options = { skip: skip_without_git };

const common_dir = (root: string) => git(root, "rev-parse", "--path-format=absolute", "--git-common-dir").trim();

const sources = (state: { turns?: string[]; agents?: string[]; tasks?: string[] }): WorkSources => ({
  turn_chats: () => [...(state.turns ?? [])],
  chat_root: async (chat_id) => chat_id,
  agent_roots: () => state.agents ?? [],
  background_roots: () => state.tasks ?? [],
});

const settled = () => new Promise((resolve) => setImmediate(resolve));

test("a turn, an agent or a background task in the same repository marks it in use, another repository does not", options, async () => {
  const repo = await repo_with("busy-main", { "src/a.txt": "a\n" });
  const other = await repo_with("busy-other", { "b.txt": "b\n" });
  const common = common_dir(repo);
  const state: { turns?: string[]; agents?: string[]; tasks?: string[] } = {};
  const busy = create_repo_busy(sources(state));
  assert.equal(await busy.in_use(common), false);
  state.turns = [other];
  assert.equal(await busy.in_use(common), false);
  state.turns = [path.join(repo, "src")];
  assert.equal(await busy.in_use(common), true);
  state.turns = [];
  state.agents = [repo];
  assert.equal(await busy.in_use(common), true);
  state.agents = [];
  state.tasks = [other, path.join(repo, "src")];
  assert.equal(await busy.in_use(common), true);
  state.tasks = [];
  assert.equal(await busy.in_use(common.toUpperCase().replaceAll("/", "\\")), false);
  state.tasks = [repo];
  assert.equal(await busy.in_use(common.toUpperCase().replaceAll("/", "\\")), true);
});

test("a background task counts through its project root and through its own working folder", options, async () => {
  const outer = await repo_with("busy-outer", { "x.txt": "x\n" });
  const inner = path.join(outer, "inner");
  await fs.mkdir(inner);
  git(inner, "init", "-q", "-b", "main");
  const state = { tasks: [outer, inner] };
  const busy = create_repo_busy(sources(state));
  assert.equal(await busy.in_use(common_dir(outer)), true);
  assert.equal(await busy.in_use(common_dir(inner)), true);
  state.tasks = [inner];
  assert.equal(await busy.in_use(common_dir(outer)), false);
});

test("a linked worktree resolves to the common git folder of its main repository", options, async () => {
  const repo = await repo_with("busy-wt", { "a.txt": "a\n" });
  const linked = path.join(await scratch("busy-wt-linked"), "tree");
  git(repo, "worktree", "add", "-q", "-b", "side", linked);
  try {
    const busy = create_repo_busy(sources({ agents: [linked] }));
    assert.equal(await busy.in_use(common_dir(repo)), true);
    assert.equal(common_dir(linked).toLowerCase(), common_dir(repo).toLowerCase());
  } finally {
    git(repo, "worktree", "remove", "--force", linked);
  }
});

test("a folder without a repository is looked up again, so a repository created later counts", options, async () => {
  const folder = await scratch("busy-late");
  const busy = create_repo_busy(sources({ turns: [folder] }));
  git(folder, "init", "-q", "-b", "main");
  assert.equal(await busy.in_use(common_dir(folder)), true);
  const plain = await scratch("busy-plain");
  const later = create_repo_busy(sources({ turns: [plain] }));
  assert.equal(await later.in_use(path.join(plain, ".git")), false);
  git(plain, "init", "-q", "-b", "main");
  assert.equal(await later.in_use(common_dir(plain)), true);
});

test("a repository opened through a junction counts for a turn working in the junction path", options, async () => {
  const real = await repo_with("busy-real", { "a.txt": "a\n" });
  const link = path.join(await scratch("busy-link"), "proj");
  await fs.symlink(real, link, "junction");
  const common = common_dir(link);
  assert.equal(path.resolve(common).toLowerCase(), path.join(real, ".git").toLowerCase());
  assert.equal(await create_repo_busy(sources({ turns: [link] })).in_use(common), true);
  assert.equal(await create_repo_busy(sources({ agents: [path.join(link, "sub")] })).in_use(common), true);
  assert.equal(await create_repo_busy(sources({ tasks: [real] })).in_use(path.join(link, ".git")), true);
});

test("a change of agent work reaches every listener once per new set of folders, also after one of them failed", async () => {
  const state: { turns?: string[]; agents?: string[]; tasks?: string[] } = { tasks: ["D:/a"] };
  const busy = create_repo_busy(sources(state));
  const heard: string[] = [];
  busy.on_change(() => {
    heard.push("first");
    throw new Error("listener failed on purpose");
  });
  const off = busy.on_change(() => heard.push("fetch"));
  busy.changed();
  busy.changed();
  await settled();
  assert.deepEqual(heard, ["first", "fetch"]);
  busy.changed();
  await settled();
  assert.deepEqual(heard, ["first", "fetch"]);
  state.turns = ["chat-1"];
  busy.changed();
  await settled();
  assert.deepEqual(heard, ["first", "fetch", "first", "fetch"]);
  off();
  state.tasks = ["d:\\A"];
  busy.changed();
  await settled();
  assert.deepEqual(heard, ["first", "fetch", "first", "fetch"]);
  state.agents = ["D:/b"];
  busy.changed();
  await settled();
  assert.deepEqual(heard, ["first", "fetch", "first", "fetch", "first"]);
});

test("the change is read after the signal, so work registered right after it in the same step counts", async () => {
  const state: { turns?: string[]; agents?: string[]; tasks?: string[] } = {};
  const busy = create_repo_busy(sources(state));
  busy.changed();
  await settled();
  let heard = 0;
  busy.on_change(() => {
    heard += 1;
  });
  busy.changed();
  state.agents = ["D:/repo"];
  await settled();
  assert.equal(heard, 1);
});

test("checkout_in_use counts work in the same checkout only, another worktree of the repository does not block it", options, async () => {
  const repo = await repo_with("busy-checkout", { "src/a.txt": "a\n" });
  const linked = path.join(await scratch("busy-checkout-linked"), "tree");
  git(repo, "worktree", "add", "-q", "-b", "side", linked);
  try {
    const state: { turns?: string[]; agents?: string[]; tasks?: string[] } = { turns: [path.join(repo, "src")] };
    const busy = create_repo_busy(sources(state));
    assert.equal(await busy.checkout_in_use(repo), true);
    assert.equal(await busy.checkout_in_use(repo.toUpperCase()), true);
    assert.equal(await busy.checkout_in_use(linked), false);
    assert.equal(await busy.in_use(common_dir(linked)), true);
    state.turns = [];
    state.tasks = [linked];
    assert.equal(await busy.checkout_in_use(repo), false);
    assert.equal(await busy.checkout_in_use(linked), true);
  } finally {
    git(repo, "worktree", "remove", "--force", linked);
  }
});
