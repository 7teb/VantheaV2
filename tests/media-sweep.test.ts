import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { change_refs, hold_ids, release_ids } from "../electron/chats/refs.ts";
import { append_message, create_chat, flush_all_sync } from "../electron/chats/store.ts";
import { media_path, new_media_id, save_attachment, write_media } from "../electron/media/files.ts";
import { sweep_attachments } from "../electron/media/sweep.ts";
import { remember_upload } from "../electron/media/uploads.ts";
import { boot_chats, chat_dirs_in, make_root, user_message } from "./fixtures/legacy/harness.ts";

let root = "";

let kept_orphan = "";

before(async () => {
  root = await make_root("vx-sweep-");
  await boot_chats(root);
});

after(async () => {
  flush_all_sync();
  await fs.rm(root, { recursive: true, force: true });
});

const past = new Date(Date.now() - 3_600_000);

const future = new Date(Date.now() + 3_600_000);

const stored = async (bytes = Buffer.from("x"), time = past) => {
  const id = new_media_id("img", "png");
  await write_media("attachment", id, bytes);
  await fs.utimes(media_path("attachment", id), time, time);
  return id;
};

const age = async (id: string) => fs.utimes(media_path("attachment", id), past, past);

const exists = (id: string) =>
  fs.access(media_path("attachment", id)).then(
    () => true,
    () => false,
  );

test("the sweep deletes nothing when a chat file cannot be read", async () => {
  kept_orphan = await stored();
  const broken = path.join(chat_dirs_in(root).data_dir, "broken-chat.vxc");
  await fs.writeFile(broken, "not a chat");
  try {
    assert.equal(await sweep_attachments(), 0);
    assert.equal(await exists(kept_orphan), true);
  } finally {
    await fs.rm(broken);
  }
});

test("the sweep deletes old unreferenced files and keeps referenced, session, held, live and newer files", async () => {
  const orphan = await stored();
  const in_chat = await save_attachment({ name: "in-chat.txt", mime: "text/plain", bytes: Buffer.from("kept by the chat file") });
  const chat = await create_chat("");
  await append_message(chat.id, user_message("u1", "look", [in_chat]));
  change_refs(new Set([in_chat.id]), new Set());
  await age(in_chat.id);
  const session = remember_upload(await save_attachment({ name: "draft.txt", mime: "text/plain", bytes: Buffer.from("still in the composer") }));
  await age(session.id);
  const held = await stored();
  hold_ids([held]);
  const live = await stored();
  change_refs(new Set(), new Set([live]));
  const newer = await stored(Buffer.from("x"), future);
  try {
    assert.equal(await sweep_attachments(), 2);
    assert.deepEqual(
      await Promise.all([kept_orphan, orphan, in_chat.id, session.id, held, live, newer].map(exists)),
      [false, false, true, true, true, true, true],
    );
  } finally {
    release_ids([held]);
    change_refs(new Set([live]), new Set());
  }
});
