import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { create_chat, flush_all_sync } from "../electron/chats/store.ts";
import { files_root, parse_scope, require_root } from "../electron/project/files-root.ts";
import { read_folder_id } from "../electron/project/folder.ts";
import { add_project, init_settings, update_project } from "../electron/settings/store.ts";
import { set_storage_root } from "../electron/storage/paths.ts";
import { boot_chats, make_root } from "./fixtures/legacy/harness.ts";

let root = "";
let project = "";

before(async () => {
  root = await make_root("vx-files-root-");
  set_storage_root(root);
  await boot_chats(root);
  const codec = { available: () => true, encrypt: (plain: string) => plain, decrypt: (cipher: string) => cipher };
  await init_settings({
    files: { settings: path.join(root, "settings.json"), secrets: path.join(root, "secrets.json"), legacy_settings: path.join(root, "legacy.json") },
    codec,
    on_change: () => undefined,
  });
  project = path.join(root, "projects", "shop");
  await fs.mkdir(project, { recursive: true });
  await add_project(project, await read_folder_id(project));
  await update_project(project, { name: "Shop frontend" });
});

after(async () => {
  flush_all_sync();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("the scope is validated at the IPC boundary", () => {
  assert.deepEqual(parse_scope({ chat_id: null, project_path: "" }), { chat_id: null, project_path: "" });
  assert.deepEqual(parse_scope({ chat_id: "c1", project_path: "D:\\x", extra: 1 }), { chat_id: "c1", project_path: "D:\\x" });
  assert.throws(() => parse_scope(null), /files scope must be an object/);
  assert.throws(() => parse_scope({ chat_id: 4, project_path: "" }), /chat id must be a string/);
  assert.throws(() => parse_scope({ chat_id: null }), /project path must be a string/);
});

test("a chat in a project browses the project folder under the project name", async () => {
  const chat = await create_chat(project);
  assert.deepEqual(await files_root({ chat_id: chat.id, project_path: "" }), { path: project, name: "Shop frontend", kind: "project" });
});

test("a chat without a project browses its own workspace folder", async () => {
  const chat = await create_chat("");
  const workspace = path.join(root, "v2", "workspaces", chat.id);
  assert.deepEqual(await files_root({ chat_id: chat.id, project_path: "" }), { path: workspace, name: chat.id, kind: "workspace" });
  assert.equal(await require_root({ chat_id: chat.id, project_path: "" }), workspace);
});

test("a new chat browses the selected project only when it is in the project list", async () => {
  assert.deepEqual(await files_root({ chat_id: null, project_path: project }), { path: project, name: "Shop frontend", kind: "project" });
  assert.equal(await files_root({ chat_id: null, project_path: "" }), null);
  await assert.rejects(require_root({ chat_id: null, project_path: "" }), /no project folder is open/);
  await assert.rejects(files_root({ chat_id: null, project_path: path.join(root, "unlisted") }), /not in the project list/);
});

test("an unknown chat is refused", async () => {
  await assert.rejects(files_root({ chat_id: "missing-chat", project_path: project }), /chat missing-chat does not exist/);
});

test("a worktree chat browses its worktree under the name of its project", async () => {
  const tree = path.join(root, "v2", "worktrees", "0a1b2c3d", "shop");
  await fs.mkdir(tree, { recursive: true });
  const chat = await create_chat(project, { path: tree, prefix: "", branch: "vx/shop", base: "d".repeat(40), created_at: "2026-10-26T10:00:00.000Z" });
  assert.deepEqual(await files_root({ chat_id: chat.id, project_path: project }), { path: tree, name: "Shop frontend", kind: "project", worktree: { branch: "vx/shop", missing: false } });
  assert.equal(await require_root({ chat_id: chat.id, project_path: project }), tree);
});
