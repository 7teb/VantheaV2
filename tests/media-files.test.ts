import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, mock, test } from "node:test";
import { image_size, init_media, is_text_attachment, media_path, read_attachment_text, save_attachment, save_tool_images, sniff_image } from "../electron/media/files.ts";
import { make_root } from "./fixtures/legacy/harness.ts";

let root = "";

const text = (value: string) => new TextEncoder().encode(value);

const bmp = () => {
  const bytes = new Uint8Array(58);
  const view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4d]);
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, 1, true);
  view.setInt32(22, 1, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  return bytes;
};

const gif = (version: string) => new Uint8Array([...text(version), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0x3b]);

before(async () => {
  root = await make_root("vx-media-");
  const dirs = { attachments: path.join(root, "attachments"), images: path.join(root, "images") };
  await fs.mkdir(dirs.attachments, { recursive: true });
  await fs.mkdir(dirs.images, { recursive: true });
  init_media(dirs);
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("text uploads that start like an image signature stay text files", async () => {
  for (const [name, content] of [
    ["cars.csv", "BMW,320i,2019\nAudi,A4,2020\n"],
    ["notes.txt", "GIF89a is the animated GIF version string\n"],
    ["bm.txt", "BM followed by plain prose that is long enough\n"],
  ]) {
    const saved = await save_attachment({ name, mime: "text/plain", bytes: text(content) });
    assert.equal(saved.kind, "file", name);
    assert.ok(saved.id.startsWith("att_"), name);
    assert.equal(await fs.readFile(media_path("attachment", saved.id), "utf8"), content);
  }
  const binary = await save_attachment({ name: "photo", mime: "text/plain", bytes: gif("GIF89a") });
  assert.deepEqual([binary.kind, binary.mime], ["file", "application/octet-stream"]);
  assert.match(binary.id, /^att_[a-z0-9]+_[a-z0-9]+\.bin$/);
  assert.deepEqual(new Uint8Array(await fs.readFile(media_path("attachment", binary.id))), gif("GIF89a"));
});

test("image uploads need an image mime and a full signature", async () => {
  assert.deepEqual(sniff_image(gif("GIF87a")), { ext: "gif", mime: "image/gif" });
  assert.deepEqual(sniff_image(gif("GIF89a")), { ext: "gif", mime: "image/gif" });
  assert.equal(sniff_image(gif("GIFxyz")), null);
  assert.deepEqual(sniff_image(bmp()), { ext: "bmp", mime: "image/bmp" });
  assert.equal(sniff_image(text("BMW,320i,2019\nAudi,A4,2020\n")), null);
  const broken = bmp();
  new DataView(broken.buffer).setUint32(10, 4096, true);
  assert.equal(sniff_image(broken), null);
  const saved = await save_attachment({ name: "pixel.bmp", mime: "image/bmp", bytes: bmp() });
  assert.equal(saved.kind, "image");
  assert.equal(saved.mime, "image/bmp");
  assert.ok(saved.id.startsWith("img_") && saved.id.endsWith(".bmp"));
  const not_image = await save_attachment({ name: "cars.bmp", mime: "image/bmp", bytes: text("BMW,320i,2019\nAudi,A4,2020\n") });
  assert.deepEqual([not_image.kind, not_image.mime], ["file", "text/plain"]);
  assert.ok(not_image.id.startsWith("att_") && not_image.id.endsWith(".bmp"));
});

const png = (width: number, height: number) => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};

const jpeg = (width: number, height: number) => {
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 0x10]), Buffer.from("Exif\0\0".padEnd(14, "x"))]);
  const quant = Buffer.from([0xff, 0xdb, 0x00, 0x04, 0x00, 0x00]);
  const frame = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, quant, frame, Buffer.alloc(12)]);
};

const webp = (chunk: string, body: number[]) => {
  const bytes = Buffer.alloc(40);
  bytes.write("RIFF", 0, "ascii");
  bytes.write("WEBP", 8, "ascii");
  bytes.write(chunk, 12, "ascii");
  Buffer.from(body).copy(bytes, 20);
  return bytes;
};

test("image sizes are read from the PNG, JPEG, GIF, WebP and BMP headers", () => {
  assert.deepEqual(image_size(png(1440, 900)), { width: 1440, height: 900 });
  assert.deepEqual(image_size(jpeg(1273, 1018)), { width: 1273, height: 1018 });
  assert.deepEqual(image_size(gif("GIF89a")), { width: 1, height: 1 });
  assert.deepEqual(image_size(webp("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 0x40, 0x06, 0x84, 0x03])), { width: 1600, height: 900 });
  const lossless = (2999 & 0x3fff) | ((1999 & 0x3fff) << 14);
  assert.deepEqual(image_size(webp("VP8L", [0x2f, lossless & 0xff, (lossless >> 8) & 0xff, (lossless >> 16) & 0xff, (lossless >>> 24) & 0xff])), { width: 3000, height: 2000 });
  assert.deepEqual(image_size(webp("VP8X", [0, 0, 0, 0, 0x7f, 0x1f, 0x00, 0xff, 0x0f, 0x00])), { width: 8064, height: 4096 });
  const tall = bmp();
  new DataView(tall.buffer).setInt32(18, 640, true);
  new DataView(tall.buffer).setInt32(22, -480, true);
  assert.deepEqual(image_size(tall), { width: 640, height: 480 });
  assert.equal(image_size(text("not an image at all")), null);
  assert.equal(image_size(jpeg(10, 10).subarray(0, 24)), null);
});

test("tool images are written as media files named by their type and reported by id", async () => {
  const ids = await save_tool_images([
    { bytes: Buffer.from("first"), mime: "image/jpeg" },
    { bytes: Buffer.from("second"), mime: "image/webp" },
  ]);
  assert.equal(ids.length, 2);
  assert.match(ids[0] ?? "", /^img_[a-z0-9]+_[a-z0-9]+[.]jpg$/);
  assert.match(ids[1] ?? "", /^img_[a-z0-9]+_[a-z0-9]+[.]webp$/);
  for (const [at, id] of ids.entries()) {
    assert.equal(await fs.readFile(media_path("attachment", id), "utf8"), at ? "second" : "first");
  }
  await assert.rejects(save_tool_images([{ bytes: Buffer.from("x"), mime: "image/svg+xml" }]), /image\/svg\+xml/);
});

const stored = async (id: string) => new Uint8Array(await fs.readFile(media_path("attachment", id)));

const utf16le = (value: string, bom: boolean) => Buffer.concat([bom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(value, "utf16le")]);

test("saved images carry the pixel size of their header", async () => {
  const wide = await save_attachment({ name: "wide.png", mime: "image/png", bytes: png(2560, 1440) });
  assert.deepEqual([wide.kind, wide.width, wide.height], ["image", 2560, 1440]);
  const photo = await save_attachment({ name: "photo.jpg", mime: "image/jpeg", bytes: jpeg(1273, 1018) });
  assert.deepEqual([photo.width, photo.height], [1273, 1018]);
  assert.equal(Object.hasOwn(photo, "model"), false);
});

test("a legacy codepage text file is stored byte for byte", async () => {
  const cp1252 = new Uint8Array([0x47, 0x72, 0xf6, 0xdf, 0x65]);
  const saved = await save_attachment({ name: "groesse.txt", mime: "text/plain", bytes: cp1252 });
  assert.deepEqual([saved.kind, saved.mime, saved.size], ["file", "text/plain", 5]);
  assert.deepEqual(await stored(saved.id), cp1252);
});

test("UTF-16 LE files with and without a BOM are text and read back decoded", async () => {
  const body = "PS C:\\> Get-Process\r\nline two of the log\r\n";
  for (const bom of [true, false]) {
    const bytes = utf16le(body, bom);
    const saved = await save_attachment({ name: "build.log", mime: "", bytes });
    assert.deepEqual([saved.kind, saved.mime], ["file", "text/plain"], String(bom));
    assert.ok(saved.id.endsWith(".log"));
    assert.ok(is_text_attachment(saved));
    assert.deepEqual(await stored(saved.id), new Uint8Array(bytes));
    assert.equal(await read_attachment_text(saved.id), body);
  }
});

test("PDF and zip files are stored as binary files with their extension and are not read as text", async () => {
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n1 0 obj\n<< /Length 5 >>\nstream\n"), Buffer.from([0x78, 0x9c, 0x00, 0x01, 0x00]), Buffer.from("\nendstream\n")]);
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]), Buffer.alloc(20)]);
  const cases = [
    { name: "Angebot.pdf", mime: "application/pdf", bytes: pdf, ext: ".pdf" },
    { name: "release.zip", mime: "application/x-zip-compressed", bytes: zip, ext: ".zip" },
  ];
  for (const entry of cases) {
    const saved = await save_attachment({ name: entry.name, mime: entry.mime, bytes: entry.bytes });
    assert.deepEqual([saved.kind, saved.name, saved.mime, saved.size], ["file", entry.name, entry.mime, entry.bytes.length]);
    assert.ok(saved.id.startsWith("att_") && saved.id.endsWith(entry.ext), saved.id);
    assert.equal(is_text_attachment(saved), false);
    assert.deepEqual(await stored(saved.id), new Uint8Array(entry.bytes));
    await assert.rejects(read_attachment_text(saved.id), /binary file/);
  }
});

test("an image mime whose bytes are no known image format becomes a binary file", async () => {
  const heic = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(16)]);
  const saved = await save_attachment({ name: "IMG_0042.HEIC", mime: "image/heic", bytes: heic });
  assert.deepEqual([saved.kind, saved.mime], ["file", "image/heic"]);
  assert.ok(saved.id.endsWith(".heic"));
  const odd = await save_attachment({ name: "blob", mime: "not a mime", bytes: heic });
  assert.equal(odd.mime, "application/octet-stream");
});

test("secret looking extensions are stored as txt for text and bin for binary files", async () => {
  const pem = await save_attachment({ name: "server.pem", mime: "application/x-pem-file", bytes: text("-----BEGIN CERTIFICATE-----\nMIIB\n") });
  assert.ok(pem.id.endsWith(".txt"));
  assert.deepEqual([pem.name, pem.mime], ["server.pem", "text/plain"]);
  const key = await save_attachment({ name: "deploy.key", mime: "", bytes: text("not really a key") });
  assert.ok(key.id.endsWith(".txt"));
  const p12 = await save_attachment({ name: "client.p12", mime: "application/x-pkcs12", bytes: Buffer.from([0x30, 0x82, 0x00, 0x00, 0x02, 0x01, 0x03]) });
  assert.ok(p12.id.endsWith(".bin"));
  assert.deepEqual([p12.name, p12.mime], ["client.p12", "application/x-pkcs12"]);
});

test("is_text_attachment accepts text files only", () => {
  const base = { id: "att_a_b.txt", name: "a", size: 1, vision_note: null };
  assert.equal(is_text_attachment({ ...base, kind: "file", mime: "text/markdown" }), true);
  assert.equal(is_text_attachment({ ...base, kind: "file", mime: "application/json" }), true);
  assert.equal(is_text_attachment({ ...base, kind: "file", mime: "application/pdf" }), false);
  assert.equal(is_text_attachment({ ...base, kind: "image", mime: "image/png" }), false);
});

test("every file kind is limited to 20 MB", async () => {
  await assert.rejects(save_attachment({ name: "huge.log", mime: "text/plain", bytes: new Uint8Array(20 * 1024 * 1024 + 1).fill(0x61) }), /20 MB/);
  await assert.rejects(save_attachment({ name: "huge.pdf", mime: "application/pdf", bytes: new Uint8Array(20 * 1024 * 1024 + 1) }), /20 MB/);
});

test("the original location is kept only when it is absolute and has the uploaded size", async () => {
  const source = path.join(root, "source.txt");
  await fs.writeFile(source, "twelve bytes");
  const kept = await save_attachment({ name: "source.txt", mime: "text/plain", bytes: text("twelve bytes"), source_path: source });
  assert.equal(kept.source_path, source);
  const warn = mock.method(console, "warn", () => {});
  try {
    const resized = await save_attachment({ name: "source.txt", mime: "text/plain", bytes: text("eleven byte"), source_path: source });
    const relative = await save_attachment({ name: "source.txt", mime: "text/plain", bytes: text("twelve bytes"), source_path: "source.txt" });
    const missing = await save_attachment({ name: "x.png", mime: "image/png", bytes: png(10, 10), source_path: path.join(root, "gone.png") });
    assert.deepEqual([resized, relative, missing].map((entry) => Object.hasOwn(entry, "source_path")), [false, false, false]);
    assert.equal(warn.mock.callCount(), 3);
  } finally {
    warn.mock.restore();
  }
});
