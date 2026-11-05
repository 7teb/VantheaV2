import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { after, test } from "node:test";
import type { Attachment, Message } from "../shared/chat.ts";
import { attachment_ids, hold_ids, release_ids } from "../electron/chats/refs.ts";
import { append_message, create_chat, delete_chat, flush_all_sync, flush_chat, fork_chat, get_chat, truncate_after, update_message } from "../electron/chats/store.ts";
import { media_path, new_media_id, save_attachment, write_media } from "../electron/media/files.ts";
import { assistant_message, boot_chats, chat_dirs_in, make_root, sleep, user_message } from "./fixtures/legacy/harness.ts";

const roots: string[] = [];

const fresh = async () => {
  const root = await make_root("vx-chat-files-");
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

const png = () => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(1920, 16);
  bytes.writeUInt32BE(1080, 20);
  return bytes;
};

const image_with_copy = async (name: string): Promise<Attachment> => {
  const original = await save_attachment({ name, mime: "image/png", bytes: png() });
  const copy = new_media_id("img", "jpg");
  await write_media("attachment", copy, Buffer.from("jpeg"));
  return { ...original, model: { id: copy, width: 1440, height: 810 } };
};

const files_of = (attachment: Attachment) => [attachment.id, attachment.model?.id ?? ""];

const exists = (id: string) =>
  fs.access(media_path("attachment", id)).then(
    () => true,
    () => false,
  );

const all_exist = (ids: string[]) => Promise.all(ids.map(exists));

const index_refs = async (root: string): Promise<Record<string, number>> => JSON.parse(await fs.readFile(chat_dirs_in(root).index_file, "utf8")).refs;

const gone = async (id: string) => {
  for (let attempt = 0; attempt < 50 && (await exists(id)); attempt += 1) {
    await sleep(20);
  }
  return !(await exists(id));
};

test("a model copy is counted with its attachment, kept by a fork and deleted with the last chat", async () => {
  const root = await fresh();
  const shot = await image_with_copy("shot.png");
  const chat = await create_chat("");
  await append_message(chat.id, user_message("u1", "look", [shot]));
  assert.deepEqual(await index_refs(root), { [shot.id]: 1, [shot.model?.id ?? ""]: 1 });
  const forked = await fork_chat(chat.id, "u1");
  assert.deepEqual(await index_refs(root), { [shot.id]: 2, [shot.model?.id ?? ""]: 2 });
  await delete_chat(chat.id);
  assert.deepEqual(await all_exist(files_of(shot)), [true, true]);
  await delete_chat(forked.id);
  assert.deepEqual(await all_exist(files_of(shot)), [false, false]);
  assert.deepEqual(await index_refs(root), {});
});

test("an attachment stored before model copies loads and counts as before", async () => {
  const root = await fresh();
  const old: Attachment = { id: "img_old_1.png", kind: "image", name: "old.png", mime: "image/png", size: 3, vision_note: "a red square" };
  const chat = await create_chat("");
  await append_message(chat.id, user_message("u1", "old", [old]));
  await flush_chat(chat.id);
  await boot_chats(root);
  const loaded = await get_chat(chat.id);
  assert.deepEqual(loaded?.messages[0], user_message("u1", "old", [old]));
  assert.deepEqual(await index_refs(root), { [old.id]: 1 });
});

test("truncate_after deletes released attachments and model copies but keeps held ids", async () => {
  const root = await fresh();
  const edited = await image_with_copy("edited.png");
  const later = await image_with_copy("later.png");
  const chat = await create_chat("");
  await append_message(chat.id, user_message("u1", "first"));
  await append_message(chat.id, assistant_message("a1", "ok"));
  const target = user_message("u2", "edit me", [edited]);
  await append_message(chat.id, target);
  await append_message(chat.id, assistant_message("a2", "ok"));
  await append_message(chat.id, user_message("u3", "later", [later]));
  const kept = attachment_ids([target]);
  hold_ids(kept);
  try {
    await truncate_after(chat.id, "a1");
  } finally {
    release_ids(kept);
  }
  assert.deepEqual(await all_exist(files_of(edited)), [true, true]);
  assert.deepEqual(await all_exist(files_of(later)), [false, false]);
  assert.deepEqual(await index_refs(root), {});
  await append_message(chat.id, user_message("u4", "edit me again", [edited]));
  assert.deepEqual(await index_refs(root), { [edited.id]: 1, [edited.model?.id ?? ""]: 1 });
});

test("update_message that drops an attachment deletes its files after the chat is saved", async () => {
  await fresh();
  const steered = await image_with_copy("steer.png");
  const chat = await create_chat("");
  await append_message(chat.id, user_message("u1", "go"));
  await append_message(chat.id, assistant_message("a1", "working", "streaming"));
  const with_steer = (message: Message): Message =>
    message.role === "assistant" ? { ...message, steps: [...message.steps, { id: "steer:1", round: 0, kind: "steer", text: "this", attachments: [steered] }] } : message;
  update_message(chat.id, "a1", with_steer);
  await flush_chat(chat.id);
  assert.deepEqual(await all_exist(files_of(steered)), [true, true]);
  update_message(chat.id, "a1", (message) => (message.role === "assistant" ? { ...message, steps: message.steps.filter((step) => step.kind !== "steer") } : message));
  assert.equal(await gone(steered.id), true);
  assert.equal(await gone(steered.model?.id ?? ""), true);
});
