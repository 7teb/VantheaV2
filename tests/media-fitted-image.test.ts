import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { default_native } from "../shared/image-fit.ts";
import { native_size } from "../shared/image-native.ts";
import { init_media, write_media } from "../electron/media/files.ts";
import { fitted_image_url } from "../electron/media/fitted-image.ts";

let root = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-fitted-image-"));
  init_media({ attachments: path.join(root, "attachments"), images: path.join(root, "images") });
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const png_header = (width: number, height: number) => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};

const claude = native_size("anthropic/claude-opus-5.5");

test("an image inside the model's native size goes out byte for byte", async () => {
  const bytes = png_header(2200, 1600);
  await write_media("attachment", "img_fit_11111111.png", bytes);
  assert.equal(await fitted_image_url("img_fit_11111111.png", "image/png", [claude]), `data:image/png;base64,${bytes.toString("base64")}`);
});

test("formats the resizer cannot decode go out unchanged instead of failing", async () => {
  const bytes = Buffer.concat([Buffer.from("GIF89a"), Buffer.from([0x40, 0x1f, 0x40, 0x1f]), Buffer.alloc(20)]);
  await write_media("attachment", "img_fit_22222222.gif", bytes);
  assert.equal(await fitted_image_url("img_fit_22222222.gif", "image/gif", [default_native]), `data:image/gif;base64,${bytes.toString("base64")}`);
});

test("a missing file rejects so the caller can say the image could not be read", async () => {
  await assert.rejects(fitted_image_url("img_fit_33333333.png", "image/png", [default_native]));
});
