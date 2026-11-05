import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { create_chat, flush_all_sync } from "../electron/chats/store.ts";
import { chat_home_of } from "../electron/chats/workspace.ts";
import { confirmed_memories, init_memory } from "../electron/memory/store.ts";
import { path_key, set_storage_root } from "../electron/storage/paths.ts";
import { memory_tools } from "../electron/tools/memory/index.ts";
import type { SideModelCall, ToolContext } from "../electron/tools/types.ts";
import { boot_chats, make_root } from "./fixtures/legacy/harness.ts";

let root = "";

before(async () => {
  root = await make_root("vx-memory-identity-");
  set_storage_root(root);
  await boot_chats(root);
  await init_memory({ file: path.join(root, "memories.json"), legacy_file: path.join(root, "memories-v2.json") });
});

after(async () => {
  flush_all_sync();
  await fs.rm(root, { recursive: true, force: true });
});

const side_model: SideModelCall = async () => JSON.stringify({ kind: "project_rule", key: "project.package", text: "Run npm run package after changes." });

test("remember in a worktree chat stores the rule under the project, not under the worktree folder", async () => {
  const project = path.join(root, "projects", "shop");
  const worktree_path = path.join(root, "v2", "worktrees", "0a1b2c3d", "shop");
  const meta = await create_chat(project, { path: worktree_path, prefix: "", branch: "vx/shop", base: "c".repeat(40), created_at: "2026-10-26T10:00:00.000Z" });
  assert.equal(await chat_home_of(meta.id), project);
  const remember = memory_tools.find((tool) => tool.spec.name === "remember");
  assert.ok(remember);
  const ctx = {
    chat_id: meta.id,
    project_root: worktree_path,
    mode: "ask",
    turn_id: "turn-1",
    signal: new AbortController().signal,
    side_model,
    approve: async () => ({ approved: true }),
  } as unknown as ToolContext;
  const outcome = await remember.execute(ctx, { text: "In this repo run npm run package after changes." });
  assert.equal(outcome.status, "done");
  const [saved] = confirmed_memories();
  assert.equal(saved?.scope, "project");
  assert.equal(saved?.project_path, path_key(project));
  await assert.rejects(chat_home_of("no-such-chat"), /chat no-such-chat not found/);
});
