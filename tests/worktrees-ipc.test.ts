import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { before, test, type TestContext } from "node:test";
import { build, type Plugin } from "esbuild";
import { chat_dirs_in } from "./fixtures/legacy/harness.ts";
import { repo_with, scratch, skip_without_git } from "./git-kit.ts";

let ipc: any;

let root = "";

const stub_path = path.resolve("tests/worktrees-ipc-stub.ts");

const stubs: Plugin = {
  name: "worktrees-ipc-stubs",
  setup: (build_api) => {
    build_api.onResolve({ filter: /^electron$|[\/]app[\/]window\.ts$|[\/]browser[\/]tabs\.ts$/ }, () => ({ path: stub_path }));
  },
};

const call = (name: string, ...args: unknown[]) => ipc.handlers.get(name)(ipc.trusted_event, ...args);

before(async () => {
  const entry = [
    'export { register_worktrees_ipc } from "./electron/ipc/worktrees.ts";',
    'export { create_chat, init_chats } from "./electron/chats/store.ts";',
    'export { add_project, init_settings } from "./electron/settings/store.ts";',
    'export { read_folder_id } from "./electron/project/folder.ts";',
    'export { set_storage_root } from "./electron/storage/paths.ts";',
    'export { adopted, handlers, trusted_event } from "./tests/worktrees-ipc-stub.ts";',
  ].join("\n");
  const result = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [stubs] });
  root = await scratch("worktrees-ipc");
  const bundle = path.join(root, "worktrees-ipc.mjs");
  await fs.writeFile(bundle, result.outputFiles[0].contents);
  ipc = await import(pathToFileURL(bundle).href);
  ipc.set_storage_root(root);
  await ipc.init_chats({ dirs: chat_dirs_in(root), legacy_root: path.join(root, "no-legacy"), events: { changed: () => {}, removed: () => {}, appended: () => {}, truncated: () => {}, questions: () => {} } });
  const codec = { available: () => true, encrypt: (plain: string) => plain, decrypt: (cipher: string) => cipher };
  await ipc.init_settings({ files: { settings: path.join(root, "settings.json"), secrets: path.join(root, "secrets.json"), legacy_settings: path.join(root, "legacy.json") }, codec, on_change: () => undefined });
  ipc.register_worktrees_ipc();
});

test("the worktree target is validated at the IPC boundary", async (t: TestContext) => {
  t.mock.method(console, "error", () => {});
  await assert.rejects(call("worktrees:work", null), /worktree target must be an object/);
  await assert.rejects(call("worktrees:work", { kind: "everything" }), /unknown worktree target kind everything/);
  await assert.rejects(call("worktrees:work", { kind: "chats", chat_ids: "c1" }), /chat ids must be an array/);
  await assert.rejects(call("worktrees:work", { kind: "chats", chat_ids: [7] }), /chat id must be a string/);
  await assert.rejects(call("worktrees:work", { kind: "project" }), /project path must be a string/);
  assert.deepEqual(await call("worktrees:work", { kind: "all" }), []);
  assert.deepEqual(await call("worktrees:work", { kind: "chats", chat_ids: ["missing"] }), []);
});

test("creating a worktree chat needs a listed project and a bounded seed text", async (t: TestContext) => {
  t.mock.method(console, "error", () => {});
  await assert.rejects(call("worktrees:create_chat", path.join(root, "unlisted"), "x"), /not in the project list/);
  await assert.rejects(call("worktrees:create_chat", 3, "x"), /project path must be a string/);
  await assert.rejects(call("worktrees:create_chat", root, null), /seed text must be a string/);
  await assert.rejects(call("worktrees:create_chat", root, "x".repeat(200_001)), /seed text is longer than 200000 characters/);
  await assert.rejects(call("worktrees:eligibility", path.join(root, "unlisted")), /not in the project list/);
});

test("head and restore refuse a chat without a worktree", async (t: TestContext) => {
  t.mock.method(console, "error", () => {});
  const meta = await ipc.create_chat("");
  await assert.rejects(call("worktrees:head", meta.id), /has no worktree/);
  await assert.rejects(call("worktrees:restore", meta.id), /has no worktree/);
  await assert.rejects(call("worktrees:head", "x".repeat(201)), /chat id is longer than 200 characters/);
});

test("a created worktree chat takes over the browser tabs of the new-chat screen", { skip: skip_without_git }, async () => {
  const project = await repo_with("wt-ipc", { "a.txt": "a" });
  await ipc.add_project(project, await ipc.read_folder_id(project));
  assert.deepEqual(await call("worktrees:eligibility", project), { kind: "ready", branch: "main", submodules: false });
  const meta = await call("worktrees:create_chat", project, "from the ipc");
  assert.equal(meta.worktree.branch, "vx/from-the-ipc");
  assert.deepEqual(ipc.adopted.at(-1)?.[1], meta.id);
  assert.deepEqual(await call("worktrees:head", meta.id), { branch: "vx/from-the-ipc", detached_at: null, missing: false });
  assert.equal((await call("worktrees:work", { kind: "project", project_path: project }))[0]?.chat_id, meta.id);
});
