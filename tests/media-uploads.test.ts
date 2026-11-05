import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { after, before, test } from "node:test";
import type { Attachment } from "../shared/chat.ts";
import { append_message, create_chat, flush_all_sync } from "../electron/chats/store.ts";
import { media_path, new_media_id, save_attachment, write_media } from "../electron/media/files.ts";
import { discard_uploads, remember_upload, uploaded } from "../electron/media/uploads.ts";
import { boot_chats, make_root, user_message } from "./fixtures/legacy/harness.ts";

let root = "";

before(async () => {
  root = await make_root("vx-uploads-");
  await boot_chats(root);
});

after(async () => {
  flush_all_sync();
  await fs.rm(root, { recursive: true, force: true });
});

const png = () => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(2560, 16);
  bytes.writeUInt32BE(1440, 20);
  return bytes;
};

const image_upload = async (name: string): Promise<Attachment> => {
  const original = await save_attachment({ name, mime: "image/png", bytes: png() });
  const copy = new_media_id("img", "jpg");
  await write_media("attachment", copy, Buffer.from("jpeg"));
  return remember_upload({ ...original, model: { id: copy, width: 1440, height: 810 } });
};

const exists = async (id: string) =>
  fs.access(media_path("attachment", id)).then(
    () => true,
    () => false,
  );

test("uploaded returns the records main created and refuses unknown ids", async () => {
  const shot = await image_upload("shot.png");
  const notes = remember_upload(await save_attachment({ name: "notes.md", mime: "text/markdown", bytes: Buffer.from("# notes") }));
  assert.deepEqual(uploaded([notes.id, shot.id]), [notes, shot]);
  assert.throws(() => uploaded([shot.id, "img_zz_00000000.png"]), /attachment img_zz_00000000\.png is not available, attach the file again/);
  assert.deepEqual(uploaded([]), []);
});

test("discard_uploads deletes unreferenced session uploads with their model copy and keeps referenced ones", async () => {
  const dropped = await image_upload("dropped.png");
  const sent = await image_upload("sent.png");
  const chat = await create_chat("");
  await append_message(chat.id, user_message("u1", "look", [sent]));
  const foreign = new_media_id("img", "png");
  await write_media("attachment", foreign, png());
  await discard_uploads([dropped.id, sent.id, foreign]);
  assert.deepEqual(await Promise.all([dropped.id, dropped.model?.id ?? ""].map(exists)), [false, false]);
  assert.deepEqual(await Promise.all([sent.id, sent.model?.id ?? ""].map(exists)), [true, true]);
  assert.equal(await exists(foreign), true);
  assert.throws(() => uploaded([dropped.id]), /not available/);
  assert.deepEqual(uploaded([sent.id]), [sent]);
});
