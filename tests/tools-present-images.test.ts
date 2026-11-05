import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { init_media, media_path } from "../electron/media/files.ts";
import { present_images_tool } from "../electron/tools/image/present.ts";
import { ToolArgumentError, type ToolContext } from "../electron/tools/types.ts";
import { make_root } from "./fixtures/legacy/harness.ts";

let root = "";

const png = (width: number, height: number): Buffer => {
  const bytes = Buffer.alloc(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};

const ctx = () => ({ chat_id: "chat-a", project_root: root, signal: new AbortController().signal, profile: "main" }) as unknown as ToolContext;

before(async () => {
  root = await make_root("vx-present-images-");
  const dirs = { attachments: path.join(root, "attachments"), images: path.join(root, "images") };
  await fs.mkdir(dirs.attachments, { recursive: true });
  await fs.mkdir(dirs.images, { recursive: true });
  init_media(dirs);
  await fs.writeFile(media_path("image", "img_aa_00000001.png"), png(1024, 768));
  await fs.writeFile(media_path("image", "img_bb_00000002.png"), png(512, 512));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("present_images shows generated images in the given order with their sizes and drops repeats", async () => {
  const result = await present_images_tool.execute(ctx(), { image_ids: ["img_bb_00000002.png", "img_aa_00000001.png", "img_bb_00000002.png"] });
  assert.equal(result.status, "done");
  assert.deepEqual(result.view, {
    kind: "image",
    images: [
      { id: "img_bb_00000002.png", width: 512, height: 512 },
      { id: "img_aa_00000001.png", width: 1024, height: 768 },
    ],
  });
  assert.equal(result.text, "The user now sees these 2 images in the chat: img_bb_00000002.png, img_aa_00000001.png.");
});

test("present_images fails on an id that is no generated image and shows nothing", async () => {
  const result = await present_images_tool.execute(ctx(), { image_ids: ["img_aa_00000001.png", "img_cc_00000003.png"] });
  assert.equal(result.status, "failed");
  assert.equal(result.view, null);
  assert.match(result.text, /No generated image with the id "img_cc_00000003\.png" exists/);
  const outside = await present_images_tool.execute(ctx(), { image_ids: ["../attachments/x.png"] });
  assert.equal(outside.status, "failed");
});

test("present_images needs at least one id and at most ten", async () => {
  await assert.rejects(Promise.resolve().then(() => present_images_tool.execute(ctx(), { image_ids: [] })), ToolArgumentError);
  await assert.rejects(Promise.resolve().then(() => present_images_tool.execute(ctx(), { image_ids: Array.from({ length: 11 }, (_, at) => `img_a_${at}.png`) })), ToolArgumentError);
});
