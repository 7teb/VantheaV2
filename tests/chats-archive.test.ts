import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { after, test } from "node:test";
import type { ChatMeta } from "../shared/chat.ts";
import { append_message, archive_all_chats, chat_meta, create_chat, delete_all_chats, flush_all_sync, fork_chat, list_chats, search_chats, set_streaming, unarchive_chat, update_meta } from "../electron/chats/store.ts";
import { archived_chats, build_sidebar, sidebar_order } from "../src/features/sidebar/sidebar-model.ts";
import { assistant_message, boot_chats, chat_dirs_in, make_root, read_disk_chat, user_message } from "./fixtures/legacy/harness.ts";

const roots: string[] = [];

const fresh = async () => {
  const root = await make_root("vx-archive-");
  roots.push(root);
  return { root, env: await boot_chats(root) };
};

after(async () => {
  flush_all_sync();
  for (const root of roots) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a chat without the archived flag loads unarchived and the flag survives a reload once set", async () => {
  const { root } = await fresh();
  const meta = await create_chat("D:\\Projects\\demo");
  assert.equal("archived" in meta, false);
  const env = await boot_chats(root);
  assert.equal(chat_meta(meta.id)?.archived, undefined);
  const archived = await update_meta(meta.id, { archived: true });
  assert.equal(archived.archived, true);
  assert.equal(env.changed.at(-1)?.archived, true);
  await boot_chats(root);
  assert.equal(chat_meta(meta.id)?.archived, true);
  const restored = await update_meta(meta.id, { archived: false });
  assert.equal("archived" in restored, false);
  await boot_chats(root);
  assert.equal("archived" in (chat_meta(meta.id) ?? {}), false);
});

test("other meta patches keep the archived flag and a malformed flag in the index loads unarchived", async () => {
  const { root } = await fresh();
  const meta = await create_chat("");
  await update_meta(meta.id, { archived: true });
  const renamed = await update_meta(meta.id, { title: "Kept", pinned: true });
  assert.equal(renamed.archived, true);
  assert.equal(renamed.pinned, true);
  const index_file = chat_dirs_in(root).index_file;
  const index = JSON.parse(await fs.readFile(index_file, "utf8"));
  index.chats[0].archived = "yes";
  await fs.writeFile(index_file, JSON.stringify(index));
  await boot_chats(root);
  assert.equal(chat_meta(meta.id)?.archived, undefined);
  assert.equal(chat_meta(meta.id)?.title, "Kept");
});

test("the archived flag is written into the chat file of a loaded chat", async () => {
  const { root } = await fresh();
  const meta = await create_chat("");
  await append_message(meta.id, user_message("u1", "hello"));
  await update_meta(meta.id, { archived: true });
  flush_all_sync();
  const stored = await read_disk_chat(root, meta.id);
  assert.equal(stored.archived, true);
});

test("a fork of an archived chat is not archived", async () => {
  await fresh();
  const meta = await create_chat("D:\\Projects\\demo");
  await append_message(meta.id, user_message("u1", "hello"));
  await append_message(meta.id, assistant_message("a1", "hi"));
  await update_meta(meta.id, { title: "Source", archived: true });
  const fork = await fork_chat(meta.id, "a1");
  assert.equal("archived" in fork, false);
  assert.equal(fork.title, "Source (fork)");
  assert.equal(fork.project_path, "D:\\Projects\\demo");
  assert.equal(chat_meta(meta.id)?.archived, true);
});

test("unarchive_chat restores an archived chat, pin included, and leaves a chat that is not archived alone", async () => {
  const { root, env } = await fresh();
  const archived = await create_chat("D:\Projects\demo");
  const plain = await create_chat("");
  await update_meta(archived.id, { pinned: true, archived: true });
  const announced = env.changed.length;
  await unarchive_chat(plain.id);
  assert.equal(env.changed.length, announced);
  await unarchive_chat(archived.id);
  assert.equal(env.changed.length, announced + 1);
  assert.equal("archived" in (env.changed.at(-1) ?? {}), false);
  assert.equal(chat_meta(archived.id)?.pinned, true);
  await boot_chats(root);
  assert.equal("archived" in (chat_meta(archived.id) ?? {}), false);
  assert.equal(chat_meta(archived.id)?.pinned, true);
});

test("search finds archived chats and marks them", async () => {
  await fresh();
  const kept = await create_chat("");
  const hidden = await create_chat("");
  await append_message(kept.id, user_message("u1", "parser rewrite"));
  await append_message(hidden.id, user_message("u2", "parser bug"));
  await update_meta(hidden.id, { archived: true });
  const hits = await search_chats("parser");
  assert.equal(hits.length, 2);
  assert.equal(hits.find((hit) => hit.chat_id === hidden.id)?.archived, true);
  assert.equal("archived" in (hits.find((hit) => hit.chat_id === kept.id) ?? {}), false);
  assert.equal(list_chats().length, 2);
});

const chat = (id: string, project_path: string, updated_at: string, flags: { pinned?: boolean; archived?: boolean } = {}): ChatMeta => ({
  id,
  title: id,
  project_path,
  workspace: "",
  pinned: flags.pinned ?? false,
  ...(flags.archived ? { archived: true } : {}),
  created_at: updated_at,
  updated_at,
  message_count: 1,
  streaming: false,
});

test("archived chats leave the pinned, project and loose lists and are listed newest first on their own", () => {
  const projects = [{ path: "D:\\work\\alpha", name: "", pinned: false, folder_id: "" }];
  const chats = [
    chat("a1", "D:\\work\\alpha", "2026-10-01T00:00:00Z"),
    chat("a2", "D:\\work\\alpha", "2026-10-02T00:00:00Z", { archived: true }),
    chat("p1", "", "2026-10-03T00:00:00Z", { pinned: true }),
    chat("p2", "", "2026-10-04T00:00:00Z", { pinned: true, archived: true }),
    chat("x1", "", "2026-10-05T00:00:00Z"),
    chat("x2", "", "2026-10-06T00:00:00Z", { archived: true }),
  ];
  const model = build_sidebar(chats, projects);
  assert.deepEqual(model.pinned.map((entry) => entry.id), ["p1"]);
  assert.deepEqual(model.projects[0].chats.map((entry) => entry.id), ["a1"]);
  assert.deepEqual(model.loose.map((entry) => entry.id), ["x1"]);
  assert.deepEqual(sidebar_order(model, []).map((entry) => entry.id), ["p1", "a1", "x1"]);
  assert.deepEqual(archived_chats(chats).map((entry) => entry.id), ["x2", "p2", "a2"]);
  assert.deepEqual(archived_chats([chat("a1", "", "2026-10-01T00:00:00Z")]), []);
});

test("archive all skips running chats and chats already archived, persists once and announces each change, delete all removes everything", async () => {
  const { root, env } = await fresh();
  const first = await create_chat("D:\Projects\demo");
  const second = await create_chat("");
  const running = await create_chat("");
  const done = await create_chat("");
  await update_meta(done.id, { archived: true });
  set_streaming(running.id, true);
  const before = env.changed.length;
  assert.deepEqual(await archive_all_chats(), { archived: 2, skipped: 1 });
  assert.deepEqual(env.changed.slice(before).map((meta) => meta.id).sort(), [first.id, second.id].sort());
  assert.equal(chat_meta(running.id)?.archived, undefined);
  await boot_chats(root);
  assert.equal(chat_meta(first.id)?.archived, true);
  assert.equal(chat_meta(second.id)?.archived, true);
  assert.equal(await delete_all_chats(), 4);
  assert.deepEqual(list_chats(), []);
});
