import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Attachment } from "../shared/chat.ts";
import { init_media, media_path } from "../electron/media/files.ts";
import { outside_message } from "../electron/project/scope.ts";
import { view_target } from "../electron/tools/vision/view-target.ts";

let root = "";

let project = "";

const own: Attachment = { id: "img_v1_00000000.png", kind: "image", name: "glass-menu.png", mime: "image/png", size: 1, vision_note: null };

const foreign: Attachment = { ...own, id: "img_v2_00000000.png", name: "other.png" };

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-view-target-"));
  project = path.join(root, "project");
  init_media({ attachments: path.join(root, "attachments"), images: path.join(root, "images") });
  await fs.mkdir(path.join(root, "attachments"), { recursive: true });
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, "shot.png"), "x");
  await fs.writeFile(path.join(project, ".env"), "SECRET=1");
  await fs.writeFile(path.join(root, "outside.png"), "x");
  await fs.writeFile(media_path("attachment", own.id), "x");
  await fs.writeFile(media_path("attachment", foreign.id), "x");
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("an attachment path of this chat is accepted, also in another case", async () => {
  const stored = media_path("attachment", own.id);
  assert.deepEqual(await view_target([own], project, stored), { file: stored, display: "glass-menu.png", relative: null });
  assert.deepEqual(await view_target([own], project, stored.toUpperCase()), { file: stored, display: "glass-menu.png", relative: null });
});

test("another chat's attachment path is outside the project", async () => {
  await assert.rejects(() => view_target([own], project, media_path("attachment", foreign.id)), { message: outside_message });
});

test("project files resolve relative and absolute with their project path, parent paths are refused", async () => {
  const shot = await view_target([], project, "shot.png");
  assert.equal(shot.display, "shot.png");
  assert.equal(shot.relative, "shot.png");
  assert.equal(path.normalize(shot.file).toLowerCase(), path.join(await fs.realpath(project), "shot.png").toLowerCase());
  assert.equal((await view_target([], project, path.join(project, "shot.png"))).display, "shot.png");
  await assert.rejects(() => view_target([], project, "..\\outside.png"), { message: outside_message });
  assert.equal((await view_target([], project, ".env")).relative, ".env");
});
