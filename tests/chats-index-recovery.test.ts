import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { brotliCompressSync } from "node:zlib";
import { append_message, create_chat, flush_all_sync, flush_chat, get_chat, list_chats } from "../electron/chats/store.ts";
import { legacy_chat_file } from "../electron/chats/legacy/import.ts";
import { boot_chats, chat_dirs_in, make_root, user_message } from "./fixtures/legacy/harness.ts";

const roots: string[] = [];
const fresh = async () => {
  const root = await make_root("vx-index-recovery-");
  roots.push(root);
  await boot_chats(root);
  return root;
};
const legacy = async (root: string, id: string) => {
  const home = path.join(root, "legacy");
  const store = path.join(home, "chat-store");
  await fs.mkdir(path.join(store, "data-v2"), { recursive: true });
  await fs.writeFile(path.join(store, "index.json"), JSON.stringify({ chats: [{ id }] }));
  await fs.writeFile(legacy_chat_file(store, id), brotliCompressSync(Buffer.from(JSON.stringify({ id, title: "Legacy copy", messages: [{ id: "old-user", role: "user", content: "Old message" }] }))));
  return home;
};
after(async () => {
  flush_all_sync();
  for (const root of roots) await fs.rm(root, { recursive: true, force: true });
});

test("a missing index recovers newer chats from their modern files", async () => {
  const root = await fresh();
  const first = await create_chat("");
  await append_message(first.id, user_message("u1", "Current history"));
  const second = await create_chat("");
  await append_message(second.id, user_message("u2", "New chat"));
  await fs.rm(chat_dirs_in(root).index_file);
  await boot_chats(root);
  assert.deepEqual(new Set(list_chats().map((entry) => entry.id)), new Set([first.id, second.id]));
  assert.equal((await get_chat(second.id))?.messages[0]?.role === "user" && (await get_chat(second.id))?.messages[0]?.id, "u2");
});

test("a missing index never replaces a modern chat with a stale legacy copy of the same id", async () => {
  const root = await fresh();
  const chat = await create_chat("");
  await append_message(chat.id, user_message("current-user", "Keep this history"));
  await flush_chat(chat.id);
  const file = path.join(chat_dirs_in(root).data_dir, `${chat.id}.vxc`);
  const before = await fs.readFile(file);
  const home = await legacy(root, chat.id);
  await fs.rm(chat_dirs_in(root).index_file);
  await boot_chats(root, home);
  assert.deepEqual(await fs.readFile(file), before);
  assert.equal((await get_chat(chat.id))?.messages[0]?.id, "current-user");
});

test("an unreadable modern file is kept instead of overwritten by a legacy import", async () => {
  const root = await fresh();
  const id = "unreadable-modern";
  const file = path.join(chat_dirs_in(root).data_dir, `${id}.vxc`);
  const before = Buffer.from("damaged modern file to recover separately");
  await fs.writeFile(file, before);
  const home = await legacy(root, id);
  await fs.rm(chat_dirs_in(root).index_file);
  await boot_chats(root, home);
  assert.deepEqual(await fs.readFile(file), before);
  assert.equal(list_chats().length, 0);
});

test("a genuinely empty modern store still imports the first legacy history", async () => {
  const root = await fresh();
  const home = await legacy(root, "legacy-first");
  await fs.rm(chat_dirs_in(root).index_file);
  await boot_chats(root, home);
  assert.equal((await get_chat("legacy-first"))?.messages[0]?.id, "old-user");
});

test("a corrupt index recovers valid files and leaves malformed files untouched", async () => {
  const root = await fresh();
  const chat = await create_chat("");
  await append_message(chat.id, user_message("current-user", "Recovered"));
  const damaged = path.join(chat_dirs_in(root).data_dir, "damaged.vxc");
  await fs.writeFile(damaged, "damaged");
  await fs.writeFile(chat_dirs_in(root).index_file, "not json");
  await boot_chats(root);
  assert.deepEqual(list_chats().map((entry) => entry.id), [chat.id]);
  assert.equal(await fs.readFile(damaged, "utf8"), "damaged");
});
