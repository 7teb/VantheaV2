import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { build, type Plugin } from "esbuild";
import { git, repo_with, scratch, skip_without_git, write } from "./git-kit.ts";
import { identity_config } from "./git-write-kit.ts";

let ipc: any;

const work: { turns: string[]; agents: string[]; tasks: string[] } = { turns: [], agents: [], tasks: [] };

const stub_path = path.resolve("tests/git-actions-ipc-stub.ts");

const stubs: Plugin = {
  name: "git-actions-ipc-stubs",
  setup: (build_api) => {
    build_api.onResolve({ filter: /^electron$|[\/]app[\/]window\.ts$|[\/]project[\/]files-root\.ts$/ }, () => ({ path: stub_path }));
  },
};

const options = { skip: skip_without_git };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
  if (!skip_without_git) await identity_config();
  const entry = [
    'export { register_git_actions_ipc } from "./electron/ipc/git-actions.ts";',
    'export { git_service, init_git } from "./electron/git/index.ts";',
    'export { handlers, sent, trusted_event } from "./tests/git-actions-ipc-stub.ts";',
  ].join("\n");
  const result = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [stubs] });
  const bundle = path.join(await scratch("git-actions-bundle"), "git-actions-ipc.mjs");
  await fs.writeFile(bundle, result.outputFiles[0].contents);
  ipc = await import(pathToFileURL(bundle).href);
  ipc.init_git({ turn_chats: () => [...work.turns], chat_root: async (chat_id: string) => chat_id, agent_roots: () => work.agents, background_roots: () => work.tasks });
  ipc.register_git_actions_ipc();
});

after(() => ipc?.git_service.stop());

const call = (name: string, ...args: unknown[]) => ipc.handlers.get(name)(ipc.trusted_event, ...args);

const scope_of = (root: string) => ({ chat_id: null, project_path: root });

const bound_repo = async (root: string) => {
  ipc.git_service.bind({ path: root, name: path.basename(root), kind: "project" });
  for (let waited = 0; waited < 20_000; waited += 50) {
    if (ipc.git_service.repo_view(root)) return;
    await sleep(50);
  }
  throw new Error(`no repository view for ${root} within 20 s`);
};

test("the commit message and the pull request text are checked before anything runs", async () => {
  const scope = scope_of("D:/nowhere");
  await assert.rejects(call("git:commit_changes", scope, "   \n "), /commit message must not be blank/);
  await assert.rejects(call("git:commit_changes", scope, "x".repeat(16_001)), /commit message is longer than 16000 characters/);
  await assert.rejects(call("git:commit_changes", scope, 42), /commit message must be a string/);
  await assert.rejects(call("git:commit_changes", { project_path: 3 }, "ok"), /files scope must be an object/);
  await assert.rejects(call("github:create_pr", scope, { title: " ", body: "", base: "main" }), /pull request title must not be blank/);
  await assert.rejects(call("github:create_pr", scope, { title: "t".repeat(257), body: "", base: "main" }), /pull request title is longer than 256 characters/);
  await assert.rejects(call("github:create_pr", scope, { title: "t", body: "b".repeat(16_001), base: "main" }), /pull request description is longer than 16000 characters/);
  await assert.rejects(call("github:create_pr", scope, null), /pull request must be an object/);
  await assert.rejects(ipc.handlers.get("git:push")({ sender: {}, senderFrame: {} }, scope), /untrusted sender/);
});

test("a turn in the same checkout makes commit and push busy, a turn in another worktree of the repository does not", options, async () => {
  const root = await repo_with("actions-busy", { "a.txt": "a\n" });
  const linked = path.join(await scratch("actions-busy-linked"), "tree");
  git(root, "worktree", "add", "-q", "-b", "side", linked);
  try {
    await write(root, { "a.txt": "b\n" });
    await bound_repo(root);
    work.turns = [root];
    assert.deepEqual(await call("git:commit_changes", scope_of(root), "Change a"), { kind: "busy" });
    assert.deepEqual(await call("git:push", scope_of(root)), { kind: "busy" });
    assert.equal(git(root, "status", "--porcelain").trim(), "M a.txt");
    work.turns = [linked];
    const result = await call("git:commit_changes", scope_of(root), "Change a");
    assert.equal(result.kind, "done");
    assert.equal(git(root, "log", "-1", "--format=%s").trim(), "Change a");
  } finally {
    work.turns = [];
    git(root, "worktree", "remove", "--force", linked);
  }
});

test("the write guard names the hooks that stay off and the programs that block commit and push", options, async () => {
  const root = await repo_with("actions-guard", { "a.txt": "a\n" });
  await bound_repo(root);
  assert.deepEqual(await call("git:write_guard", scope_of(root)), { hooks_off: false, commit_block: [], push_block: [] });
  await write(root, { ".husky/pre-commit": "npx lint-staged\n" });
  git(root, "config", "filter.lfs.clean", "git-lfs clean -- %f");
  git(root, "config", "credential.helper", "store");
  assert.deepEqual(await call("git:write_guard", scope_of(root)), { hooks_off: true, commit_block: ["filter.lfs"], push_block: ["filter.lfs", "credential.helper"] });
});

test("write message with nothing changed answers nothing without a model call", options, async () => {
  const root = await repo_with("actions-nothing", { "a.txt": "a\n" });
  await bound_repo(root);
  assert.deepEqual(await call("git:write_message", scope_of(root)), { kind: "nothing" });
});
