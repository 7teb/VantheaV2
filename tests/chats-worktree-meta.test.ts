import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import type { ChatMeta, ChatWorktree } from "../shared/chat.ts";
import { append_message, chat_meta, create_chat, delete_chat, flush_all_sync, fork_chat, list_chats, on_chat_removed } from "../electron/chats/store.ts";
import { parse_worktree } from "../electron/chats/worktree-coerce.ts";
import { boot_chats, chat_dirs_in, make_root, read_disk_chat, user_message } from "./fixtures/legacy/harness.ts";

const roots: string[] = [];

after(async () => {
  flush_all_sync();
  for (const root of roots) await fs.rm(root, { recursive: true, force: true });
});

const worktree: ChatWorktree = {
  path: String.raw`C:\Users\u\AppData\Roaming\VantheaX\v2\worktrees\0a1b2c3d\shop`,
  prefix: "apps/web",
  branch: "vx/fix-login",
  base: "a".repeat(40),
  created_at: "2026-10-26T10:00:00.000Z",
};

test("a worktree is stored in the index and the chat file and survives a restart", async () => {
  const root = await make_root("vx-chats-worktree-");
  roots.push(root);
  await boot_chats(root);
  const meta = await create_chat(String.raw`D:\Projects\shop\apps\web`, worktree);
  assert.deepEqual(meta.worktree, worktree);
  assert.equal((await create_chat(String.raw`D:\Projects\shop`)).worktree, undefined);
  await append_message(meta.id, user_message("u1", "hello"));
  flush_all_sync();
  const index = JSON.parse(await fs.readFile(chat_dirs_in(root).index_file, "utf8"));
  assert.deepEqual(index.chats.find((entry: ChatMeta) => entry.id === meta.id)?.worktree, worktree);
  assert.deepEqual((await read_disk_chat(root, meta.id)).worktree, worktree);
  await boot_chats(root);
  assert.deepEqual(chat_meta(meta.id)?.worktree, worktree);
  assert.equal(list_chats().filter((entry) => entry.worktree).length, 1);
  const fork = await fork_chat(meta.id, "u1");
  assert.deepEqual(fork.worktree, worktree);
});

test("the removed listener receives the meta of the deleted chat", async () => {
  const root = await make_root("vx-chats-worktree-");
  roots.push(root);
  await boot_chats(root);
  const meta = await create_chat(String.raw`D:\Projects\shop`, { ...worktree, prefix: "" });
  const seen: [string, ChatMeta][] = [];
  const stop = on_chat_removed((chat_id, removed) => void seen.push([chat_id, removed]));
  await delete_chat(meta.id);
  stop();
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.[0], meta.id);
  assert.deepEqual(seen[0]?.[1].worktree, { ...worktree, prefix: "" });
});

test("only well-formed worktrees are kept when a chat is read from disk", () => {
  assert.deepEqual(parse_worktree(worktree), worktree);
  assert.deepEqual(parse_worktree({ ...worktree, base: "b".repeat(64), prefix: "" }), { ...worktree, base: "b".repeat(64), prefix: "" });
  for (const bad of [
    null,
    "x",
    { ...worktree, path: "relative/path" },
    { ...worktree, prefix: "../escape" },
    { ...worktree, prefix: "a//b" },
    { ...worktree, prefix: String.raw`a\b` },
    { ...worktree, prefix: 3 },
    { ...worktree, branch: "bad name" },
    { ...worktree, branch: "-x" },
    { ...worktree, base: "abc" },
    { ...worktree, base: "A".repeat(40) },
    { ...worktree, created_at: "yesterday" },
  ]) {
    assert.equal(parse_worktree(bad), undefined, JSON.stringify(bad));
  }
  assert.equal(path.isAbsolute(worktree.path), true);
});
