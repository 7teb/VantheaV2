import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { message_attachments, type AssistantMessage } from "../shared/chat.ts";
import { append_message, create_chat, init_chats } from "../electron/chats/store.ts";
import { init_media, save_attachment } from "../electron/media/files.ts";
import { chat_attachment, read_attachment_tool } from "../electron/tools/attachments/index.ts";
import type { ToolContext } from "../electron/tools/types.ts";
import { review_stub } from "./review-stub.ts";
import { tool_model } from "./tool-model.ts";

let root = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-tools-attachments-"));
  const dirs = { attachments: path.join(root, "attachments"), images: path.join(root, "images") };
  await fs.mkdir(dirs.attachments, { recursive: true });
  await fs.mkdir(dirs.images, { recursive: true });
  init_media(dirs);
  await init_chats({
    dirs: { index_file: path.join(root, "index.json"), data_dir: path.join(root, "data"), search_dir: path.join(root, "search") },
    legacy_root: path.join(root, "legacy"),
    events: { changed: () => undefined, removed: () => undefined, appended: () => undefined, truncated: () => undefined, questions: () => undefined },
  });
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const context = (chat_id: string): ToolContext => ({
  chat_id,
  turn_id: "turn-attachments",
  call_id: "call",
  project_root: root,
  user_request: "read the steer file",
  mode: "auto",
  profile: "main",
  model: tool_model,
  image_fit: [],
  settings: {} as ToolContext["settings"],
  signal: new AbortController().signal,
  progress: () => undefined,
  approve: async () => {
    throw new Error("no approval expected");
  },
  side_model: async () => "",
  review: review_stub(),
  message_main: null, send_peer: null, context: () => ({ used: 0, limit: 0, compact_at: null }),
});

test("read_attachment finds a text file attached to a steer inside an assistant message", async () => {
  const chat = await create_chat(root);
  const attachment = await save_attachment({ name: "notes.txt", mime: "text/plain", bytes: new TextEncoder().encode("steer file body") });
  const message: AssistantMessage = {
    id: "assistant-1",
    role: "assistant",
    model: "m",
    effort: "",
    mode: "auto",
    plan: false,
    created_at: new Date().toISOString(),
    ended_at: null,
    status: "streaming",
    steps: [{ id: "steer-1", round: 0, kind: "steer", text: "also look at this", attachments: [attachment] }],
    reasoning_details: [],
    retry: null,
    error: null,
    context: null,
    last_seq: 0,
  };
  await append_message(chat.id, message);
  assert.deepEqual(message_attachments(message), [attachment]);
  const result = await read_attachment_tool.execute(context(chat.id), { handle: attachment.id });
  assert.equal(result.status, "done");
  assert.match(result.text, /steer file body/);
  const missing = await read_attachment_tool.execute(context(chat.id), { handle: "att_missing_0000.txt" });
  assert.equal(missing.status, "failed");
  assert.match(missing.text, /No text attachment with the id "att_missing_0000.txt"/);
});

test("read_attachment refuses a binary file with a pointer to its path and finds files only", async () => {
  const chat = await create_chat(root);
  const pdf = await save_attachment({ name: "Angebot.pdf", mime: "application/pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02]) });
  const message: AssistantMessage = {
    id: "assistant-2",
    role: "assistant",
    model: "m",
    effort: "",
    mode: "auto",
    plan: false,
    created_at: new Date().toISOString(),
    ended_at: null,
    status: "streaming",
    steps: [{ id: "steer-2", round: 0, kind: "steer", text: "the offer", attachments: [pdf] }],
    reasoning_details: [],
    retry: null,
    error: null,
    context: null,
    last_seq: 0,
  };
  await append_message(chat.id, message);
  assert.equal(await chat_attachment(chat.id, pdf.id, "image"), null);
  assert.equal((await chat_attachment(chat.id, pdf.id, "file"))?.id, pdf.id);
  assert.equal(await chat_attachment("another-chat", pdf.id, "file"), null);
  const result = await read_attachment_tool.execute(context(chat.id), { handle: pdf.id });
  assert.equal(result.status, "failed");
  assert.equal(result.text, '"Angebot.pdf" is a binary file. Open it through the path in its <file> tag with a script.');
});
