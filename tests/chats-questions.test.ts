import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { brotliCompressSync } from "node:zlib";
import { after, mock, test } from "node:test";
import type { AssistantMessage, ToolStep } from "../shared/chat.ts";
import { set_question_states } from "../electron/chats/questions.ts";
import { append_message, create_chat, flush_all_sync, flush_chat, fork_chat, get_chat, truncate_after } from "../electron/chats/store.ts";
import { assistant_message, boot_chats, chat_dirs_in, make_root, read_disk_chat, user_message } from "./fixtures/legacy/harness.ts";

const roots: string[] = [];

after(async () => {
  flush_all_sync();
  for (const root of roots) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

const fresh = async () => {
  const root = await make_root("vx-chat-questions-");
  roots.push(root);
  return { root, env: await boot_chats(root) };
};

const ask_step = (call_id: string, view: unknown): ToolStep => ({
  id: `tool:0:${call_id}`,
  round: 0,
  kind: "tool",
  index: 0,
  call_id,
  name: "ask_user",
  args: {},
  status: "done",
  progress: null,
  approval: null,
  view: view as ToolStep["view"],
  error: null,
  result_text: "shown",
  started_at: 1,
  ended_at: 2,
});

const rewrite_disk = async (root: string, chat_id: string, change: (json: Record<string, unknown>) => void) => {
  const json = await read_disk_chat(root, chat_id);
  change(json);
  await fs.writeFile(path.join(chat_dirs_in(root).data_dir, `${chat_id}.vxc`), brotliCompressSync(Buffer.from(JSON.stringify(json), "utf8")));
};

test("a new chat starts without question states and stores an empty map", async () => {
  const { root } = await fresh();
  const meta = await create_chat("");
  assert.deepEqual((await get_chat(meta.id))?.questions, {});
  assert.deepEqual((await read_disk_chat(root, meta.id)).questions, {});
});

test("question states round-trip through disk without the sending entries and emit the whole map", async () => {
  const { root, env } = await fresh();
  const meta = await create_chat("");
  set_question_states(meta.id, { "m:c:0": "answered", "m:c:1": "dismissed", "m:c:2": "sending", "m:c:3": "answered" });
  set_question_states(meta.id, { "m:c:3": null });
  assert.deepEqual(env.questions.at(-1), { chat_id: meta.id, questions: { "m:c:0": "answered", "m:c:1": "dismissed", "m:c:2": "sending" } });
  assert.deepEqual((await get_chat(meta.id))?.questions, { "m:c:0": "answered", "m:c:1": "dismissed", "m:c:2": "sending" });
  await flush_chat(meta.id);
  assert.deepEqual((await read_disk_chat(root, meta.id)).questions, { "m:c:0": "answered", "m:c:1": "dismissed" });
  await boot_chats(root);
  assert.deepEqual((await get_chat(meta.id))?.questions, { "m:c:0": "answered", "m:c:1": "dismissed" });
});

test("junk question states on disk are dropped with a warning naming the chat and the key", async () => {
  const { root } = await fresh();
  const meta = await create_chat("");
  await flush_chat(meta.id);
  const long_key = "k".repeat(301);
  await rewrite_disk(root, meta.id, (json) => {
    json.questions = { "m:c:0": "answered", "m:c:1": "sending", "m:c:2": "maybe", [long_key]: "dismissed", "m:c:3": 4 };
  });
  const warn = mock.method(console, "warn", () => {});
  try {
    await boot_chats(root);
    assert.deepEqual((await get_chat(meta.id))?.questions, { "m:c:0": "answered" });
    const texts = warn.mock.calls.map((call) => String(call.arguments[0]));
    assert.equal(texts.length, 4);
    assert.ok(texts.every((text) => text.includes(`in chat ${meta.id}`)));
    assert.ok(texts.some((text) => text.includes("m:c:1")));
    assert.ok(texts.some((text) => text.includes("m:c:2")));
    assert.ok(texts.some((text) => text.includes("m:c:3")));
  } finally {
    warn.mock.restore();
  }
});

test("a malformed questions view on disk is dropped with a warning and a valid one is kept", async () => {
  const { root } = await fresh();
  const meta = await create_chat("");
  const valid = { kind: "questions", questions: [{ title: "Which runner?", options: ["node --test"] }] };
  const message: AssistantMessage = {
    ...assistant_message("a1", ""),
    steps: [ask_step("c0_0", valid), ask_step("c0_1", { kind: "questions", questions: [{ title: 5, options: [] }] }), ask_step("c0_2", { kind: "questions" })],
  };
  await append_message(meta.id, message);
  await flush_chat(meta.id);
  const warn = mock.method(console, "warn", () => {});
  try {
    await boot_chats(root);
    const loaded = (await get_chat(meta.id))?.messages[0];
    const views = loaded?.role === "assistant" ? loaded.steps.map((step) => (step.kind === "tool" ? step.view : undefined)) : [];
    assert.deepEqual(views, [valid, null, null]);
    const texts = warn.mock.calls.map((call) => String(call.arguments[0]));
    assert.deepEqual(texts, [
      `[questions] dropped the malformed questions view in chat ${meta.id}, step c0_1`,
      `[questions] dropped the malformed questions view in chat ${meta.id}, step c0_2`,
    ]);
  } finally {
    warn.mock.restore();
  }
});

test("fork copies the stored question states and truncation keeps them", async () => {
  await fresh();
  const meta = await create_chat("");
  await append_message(meta.id, user_message("u1", "go"));
  await append_message(meta.id, assistant_message("a1", "asked"));
  await append_message(meta.id, user_message("u2", "more"));
  set_question_states(meta.id, { "a1:c:0": "answered", "a1:c:1": "sending" });
  const fork = await fork_chat(meta.id, "a1");
  assert.deepEqual((await get_chat(fork.id))?.questions, { "a1:c:0": "answered" });
  await truncate_after(meta.id, "a1");
  assert.deepEqual((await get_chat(meta.id))?.questions, { "a1:c:0": "answered", "a1:c:1": "sending" });
});

test("setting question states on an unknown chat does nothing", async () => {
  const { env } = await fresh();
  set_question_states("missing", { "a:b:0": "dismissed" });
  assert.deepEqual(env.questions, []);
});
