import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { brotliCompressSync } from "node:zlib";
import type { Chat } from "../shared/chat.ts";
import { import_legacy_chats, legacy_chat_file } from "../electron/chats/legacy/import.ts";
import { init_artifacts, list_artifacts } from "../electron/media/artifacts.ts";
import { init_media, media_exists } from "../electron/media/files.ts";
import { import_legacy_media } from "../electron/media/legacy.ts";
import { make_root, media_dirs_in } from "./fixtures/legacy/harness.ts";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

let root = "";
let legacy_root = "";

before(async () => {
  root = await make_root("vx-media-legacy-");
  legacy_root = path.join(root, "legacy");
  const dirs = media_dirs_in(root);
  await fs.mkdir(dirs.attachments, { recursive: true });
  await fs.mkdir(dirs.images, { recursive: true });
  init_media(dirs);
  await fs.mkdir(path.join(legacy_root, "images", "img_blocked_0001.png"), { recursive: true });
  await fs.mkdir(path.join(legacy_root, "files", "att_blocked_0002.log"), { recursive: true });
  await fs.writeFile(path.join(legacy_root, "images", "img_good_0003.png"), png);
  await fs.writeFile(path.join(legacy_root, "files", "att_good_0004.log"), "log line\n");
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("a legacy media file that cannot be linked or copied stays unresolved instead of throwing", async () => {
  assert.equal(await import_legacy_media(legacy_root, { bucket: "image", name: "img_blocked_0001.png" }), false);
  assert.equal(await import_legacy_media(legacy_root, { bucket: "image", name: "img_missing_0005.png" }), false);
  assert.equal(await import_legacy_media(legacy_root, { bucket: "image", name: "img_good_0003.png" }), true);
  assert.equal(await media_exists("image", "img_blocked_0001.png"), false);
  assert.equal(await media_exists("image", "img_good_0003.png"), true);
});

test("the artifacts import keeps going past a media file it cannot import", async () => {
  const legacy_file = path.join(legacy_root, "artifacts.json");
  await fs.writeFile(
    legacy_file,
    JSON.stringify([
      { name: "img_blocked_0001.png", kind: "image", title: "Blocked", projectPath: "", createdAt: "2026-09-01T00:00:00.000Z" },
      { name: "img_good_0003.png", kind: "image", title: "Good", projectPath: "", createdAt: "2026-09-02T00:00:00.000Z" },
    ]),
  );
  const file = path.join(root, "v2", "artifacts.json");
  await init_artifacts({ file, legacy_file, legacy_root, on_change: () => undefined });
  assert.deepEqual(list_artifacts("").map((entry) => entry.id).sort(), ["img_blocked_0001.png", "img_good_0003.png"]);
  await fs.access(file);
});

test("a legacy chat is imported even when one of its media files cannot be imported", async () => {
  const store = path.join(legacy_root, "chat-store");
  await fs.mkdir(path.join(store, "data-v2"), { recursive: true });
  const id = "b10c0000-0000-4000-8000-000000000001";
  const legacy_chat = {
    id,
    projectPath: "",
    workspaceName: "",
    title: "Blocked media",
    createdAt: "2026-09-01T00:00:00.000Z",
    messages: [
      { id: "u1", role: "user", content: "two logs", attachments: [{ name: "att_blocked_0002.log", kind: "file" }, { name: "att_good_0004.log", kind: "file" }] },
    ],
  };
  await fs.writeFile(legacy_chat_file(store, id), brotliCompressSync(Buffer.from(JSON.stringify(legacy_chat))));
  await fs.writeFile(path.join(store, "index.json"), JSON.stringify({ version: 2, chats: [{ id }] }));
  const adopted: Chat[] = [];
  assert.equal(await import_legacy_chats(legacy_root, async (chat) => void adopted.push(chat)), 1);
  assert.equal(adopted[0]?.id, id);
  const user = adopted[0]?.messages[0];
  assert.deepEqual(user?.role === "user" ? user.attachments.map((entry) => entry.id) : [], ["att_blocked_0002.log", "att_good_0004.log"]);
  assert.equal(await media_exists("attachment", "att_good_0004.log"), true);
  assert.equal(await media_exists("attachment", "att_blocked_0002.log"), false);
});
