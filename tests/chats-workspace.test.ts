import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ChatMeta } from "../shared/chat.ts";
import { legacy_workspace } from "../electron/chats/legacy/workspace.ts";
import { chat_home, chat_root, is_worktree_missing } from "../electron/chats/workspace.ts";
import { set_storage_root } from "../electron/storage/paths.ts";
import { make_root } from "./fixtures/legacy/harness.ts";

let root = "";

const meta = (patch: Partial<ChatMeta>): ChatMeta => ({
  id: "0b9e0000-0000-4000-8000-000000000001",
  title: "",
  project_path: "",
  workspace: "",
  pinned: false,
  created_at: "2026-10-06T00:00:00.000Z",
  updated_at: "2026-10-06T00:00:00.000Z",
  message_count: 0,
  streaming: false,
  ...patch,
});

before(async () => {
  root = await make_root("vx-workspace-");
  set_storage_root(root);
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("legacy workspace names map to the legacy workspace folder only for chats without a project", () => {
  assert.equal(legacy_workspace(root, "", "2026-09-12 Explain RAII 0b9e"), path.join(root, "workspace", "2026-09-12 Explain RAII 0b9e"));
  assert.equal(legacy_workspace(root, "", 'a:b/c*?"<>|  d...'), path.join(root, "workspace", "abc d"));
  assert.equal(legacy_workspace(root, "", "..."), path.join(root, "workspace", "chat"));
  assert.equal(legacy_workspace(root, "D:\\Projects\\demo", "2026-09-12 stale"), "");
  assert.equal(legacy_workspace(root, "", ""), "");
});

test("a chat runs in its project, its imported workspace, or a per-chat workspace created on demand", async () => {
  assert.equal(await chat_root(meta({ project_path: "D:\\Projects\\demo", workspace: "stale name" })), "D:\\Projects\\demo");
  const own = await chat_root(meta({}));
  assert.equal(own, path.join(root, "v2", "workspaces", "0b9e0000-0000-4000-8000-000000000001"));
  assert.ok((await fs.stat(own)).isDirectory());
  const imported = path.join(root, "workspace", "2026-09-12 Explain RAII 0b9e");
  assert.equal(await chat_root(meta({ workspace: imported })), imported);
  assert.ok((await fs.stat(imported)).isDirectory());
  const relative = await chat_root(meta({ workspace: "2026-09-25 Crash log 9a8b" }));
  assert.equal(relative, path.join(root, "workspace", "2026-09-25 Crash log 9a8b"));
  assert.ok((await fs.stat(relative)).isDirectory());
});

test("a worktree chat works in its worktree plus the project prefix and keeps the project as its home", async () => {
  const worktree_path = path.join(root, "v2", "worktrees", "0a1b2c3d", "repo");
  await fs.mkdir(path.join(worktree_path, "apps", "web"), { recursive: true });
  const worktree = { path: worktree_path, prefix: "apps/web", branch: "vx/web", base: "0".repeat(40), created_at: "2026-10-26T00:00:00.000Z" };
  const chat = meta({ project_path: String.raw`D:\Projects\repo\apps\web`, worktree });
  assert.equal(await chat_root(chat), path.join(worktree_path, "apps", "web"));
  assert.equal(await chat_home(chat), String.raw`D:\Projects\repo\apps\web`);
  assert.equal(await chat_root(meta({ project_path: String.raw`D:\Projects\repo`, worktree: { ...worktree, prefix: "" } })), worktree_path);
  await assert.rejects(chat_root(meta({ project_path: String.raw`D:\Projects\repo`, worktree: { ...worktree, path: path.join(root, "v2", "worktrees", "ffffffff", "repo") } })), is_worktree_missing);
  assert.equal(await chat_root(meta({ project_path: String.raw`D:\Projects\demo` })), String.raw`D:\Projects\demo`);
});
