import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Message, ToolStep } from "../shared/chat.ts";
import { attachment_ids } from "../electron/chats/refs.ts";
import { init_media, media_path } from "../electron/media/files.ts";
import { show_images_tool } from "../electron/tools/image/show.ts";
import { ToolArgumentError, type ToolContext } from "../electron/tools/types.ts";
import { tool_label } from "../src/features/tools/tool-meta.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";
import { make_root } from "./fixtures/legacy/harness.ts";

let root = "";
let project = "";

const t: Translate = (key, vars) => translate("en", key, vars);

const png = (width: number, height: number): Buffer => {
  const bytes = Buffer.alloc(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};

const ctx = () => ({ chat_id: "chat-a", project_root: project, signal: new AbortController().signal, profile: "main" }) as unknown as ToolContext;

before(async () => {
  root = await make_root("vx-show-images-");
  const dirs = { attachments: path.join(root, "attachments"), images: path.join(root, "images") };
  project = path.join(root, "project");
  await fs.mkdir(dirs.attachments, { recursive: true });
  await fs.mkdir(dirs.images, { recursive: true });
  await fs.mkdir(path.join(project, "shots"), { recursive: true });
  await fs.writeFile(path.join(project, "shots", "wide.png"), png(800, 400));
  await fs.writeFile(path.join(root, "outside.png"), png(300, 600));
  await fs.writeFile(path.join(project, "notes.txt"), "not an image, just some text in a file");
  init_media(dirs);
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("show_images copies project-relative and outside images into the chat media and keeps their full paths", async () => {
  const outside = path.join(root, "outside.png");
  const result = await show_images_tool.execute(ctx(), { paths: ["shots/wide.png", outside] });
  assert.equal(result.status, "done");
  assert.equal(result.view?.kind, "shown_images");
  if (result.view?.kind !== "shown_images") {
    return;
  }
  assert.deepEqual(
    result.view.images.map((image) => [image.path, image.width, image.height]),
    [
      [path.join(project, "shots", "wide.png"), 800, 400],
      [outside, 300, 600],
    ],
  );
  for (const image of result.view.images) {
    assert.match(image.id, /^img_[a-z0-9]+_[a-z0-9]+\.png$/);
    assert.deepEqual(await fs.readFile(media_path("attachment", image.id)), await fs.readFile(image.path));
  }
  assert.match(result.text, /^The user now sees these 2 images in the chat/);
  assert.match(result.text, /The images are not sent to you\.$/);
  assert.equal(result.images, undefined);
});

test("show_images refuses a file that is not an image and stores nothing", async () => {
  const before_files = await fs.readdir(path.join(root, "attachments"));
  const result = await show_images_tool.execute(ctx(), { paths: ["shots/wide.png", "notes.txt"] });
  assert.equal(result.status, "failed");
  assert.match(result.text, /notes\.txt is not a PNG, JPEG, GIF, WebP or BMP image\./);
  assert.deepEqual(await fs.readdir(path.join(root, "attachments")), before_files);
});

test("show_images needs at least one path and at most ten", async () => {
  await assert.rejects(Promise.resolve().then(() => show_images_tool.execute(ctx(), { paths: [] })), ToolArgumentError);
  await assert.rejects(Promise.resolve().then(() => show_images_tool.execute(ctx(), { paths: Array.from({ length: 11 }, (_, at) => `${at}.png`) })), ToolArgumentError);
});

test("shown images count as chat media so the sweep keeps them while a chat shows them", () => {
  const step = {
    kind: "tool",
    images: [{ id: "img_a_1.png", label: "" }],
    view: { kind: "shown_images", images: [{ id: "img_b_2.png", path: "C:/shots/b.png", width: 1, height: 1 }] },
  };
  const message = { role: "assistant", steps: [step] } as unknown as Message;
  assert.deepEqual([...attachment_ids([message])].sort(), ["img_a_1.png", "img_b_2.png"]);
});

test("the show_images row names the first file and how many more follow", () => {
  const step = (paths: string[], status: ToolStep["status"]) =>
    ({
      id: "s1",
      kind: "tool",
      name: "show_images",
      args: { paths },
      status,
      progress: null,
      approval: null,
      view: status === "done" ? { kind: "shown_images", images: paths.map((entry, at) => ({ id: `img_a_${at}.png`, path: entry, width: 1, height: 1 })) } : null,
      error: null,
      result_text: "",
      started_at: null,
      ended_at: null,
    }) as unknown as ToolStep;
  assert.equal(tool_label(t, step(["C:/shots/a.png"], "running")), "Showing a.png");
  assert.equal(tool_label(t, step(["C:/shots/a.png", "C:/shots/b.png", "C:/shots/c.png"], "done")), "Showed a.png +2");
});
