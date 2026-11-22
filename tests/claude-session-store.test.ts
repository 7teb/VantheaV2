import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { after, test } from "node:test";
import type { ChatMeta } from "../shared/chat.ts";
import type { ClaudeSessionRef } from "../electron/claude/runtime.ts";
import { claude_session_of, set_claude_session } from "../electron/chats/claude-session.ts";
import { parse_body } from "../electron/chats/files.ts";
import { append_message, create_chat, delete_chat, flush_all_sync, flush_chat, fork_chat, get_chat, on_chat_removed, truncate_after, update_message } from "../electron/chats/store.ts";
import { assistant_message, boot_chats, make_root, read_disk_chat, user_message } from "./fixtures/legacy/harness.ts";

const roots: string[] = [];

const fresh = async () => {
  const root = await make_root("vx-tmp-claude-chats-");
  roots.push(root);
  await boot_chats(root);
  return root;
};

after(async () => {
  flush_all_sync();
  for (const root of roots) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

const ref: ClaudeSessionRef = { session_id: "4f1c2d3e-0000-4000-8000-000000000001", cwd: "D:\\Projects\\demo", through_message_id: "a1" };

const worked_chat = async (): Promise<ChatMeta> => {
  const meta = await create_chat("D:\\Projects\\demo");
  await append_message(meta.id, user_message("u1", "hello"));
  await append_message(meta.id, assistant_message("a1", "hi there"));
  return meta;
};

test("the Claude Code session pointer survives a save and a reload from disk", async () => {
  const root = await fresh();
  const meta = await worked_chat();
  await set_claude_session(meta.id, ref);
  assert.deepEqual(await claude_session_of(meta.id), ref);
  assert.deepEqual((await read_disk_chat(root, meta.id)).claude_session, ref);
  await boot_chats(root);
  assert.deepEqual(await claude_session_of(meta.id), ref);
});

test("the pointer never reaches the composed chat the renderer gets", async () => {
  await fresh();
  const meta = await worked_chat();
  await set_claude_session(meta.id, ref);
  const chat = await get_chat(meta.id);
  assert.ok(chat);
  assert.equal("claude_session" in chat, false);
});

test("message updates and truncation keep the pointer, and clearing it removes the key from the file", async () => {
  const root = await fresh();
  const meta = await worked_chat();
  await append_message(meta.id, user_message("u2", "more"));
  await set_claude_session(meta.id, ref);
  update_message(meta.id, "u2", (message) => (message.role === "user" ? { ...message, text: "more please" } : message));
  await flush_chat(meta.id);
  assert.deepEqual((await read_disk_chat(root, meta.id)).claude_session, ref);
  await truncate_after(meta.id, "a1");
  assert.deepEqual(await claude_session_of(meta.id), ref);
  await set_claude_session(meta.id, null);
  assert.equal(await claude_session_of(meta.id), null);
  assert.equal("claude_session" in (await read_disk_chat(root, meta.id)), false);
});

test("a fork starts without the pointer of its source chat", async () => {
  await fresh();
  const meta = await worked_chat();
  await set_claude_session(meta.id, ref);
  const fork = await fork_chat(meta.id, "a1");
  assert.equal(await claude_session_of(fork.id), null);
  assert.deepEqual(await claude_session_of(meta.id), ref);
});

test("the removed listener receives the pointer of the deleted chat", async () => {
  await fresh();
  const meta = await worked_chat();
  await set_claude_session(meta.id, ref);
  const plain = await worked_chat();
  const seen: [string, string, ClaudeSessionRef | undefined][] = [];
  const stop = on_chat_removed((chat_id, removed, claude_session) => {
    seen.push([chat_id, removed.id, claude_session]);
  });
  try {
    await delete_chat(meta.id);
    await delete_chat(plain.id);
  } finally {
    stop();
  }
  assert.deepEqual(seen, [
    [meta.id, meta.id, ref],
    [plain.id, plain.id, undefined],
  ]);
});

test("storing a pointer for a deleted chat fails with the session id and clearing it is a no-op", async () => {
  await fresh();
  const meta = await worked_chat();
  await delete_chat(meta.id);
  await assert.rejects(set_claude_session(meta.id, ref), new RegExp(ref.session_id));
  await set_claude_session(meta.id, null);
  assert.equal(await claude_session_of(meta.id), null);
});

test("parse_body keeps a complete pointer and drops a malformed one", () => {
  const body = (claude_session: unknown) => parse_body({ messages: [], questions: {}, summary: null, claude_session }, "chat-x");
  assert.deepEqual(body(ref)?.claude_session, ref);
  for (const broken of [null, "session", { ...ref, session_id: "" }, { ...ref, cwd: 7 }, { session_id: ref.session_id, cwd: ref.cwd }]) {
    const parsed = body(broken);
    assert.ok(parsed);
    assert.equal("claude_session" in parsed, false, JSON.stringify(broken));
  }
});
