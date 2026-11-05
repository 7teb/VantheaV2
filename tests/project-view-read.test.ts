import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { max_view_bytes } from "../shared/ipc/files.ts";
import { read_for_view } from "../electron/project/view-read.ts";

let root = "";
let outside = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-view-"));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), "vx-view-outside-"));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src", "main.ts"), "const a = 1;\r\nconst b = 2;\r\n");
  await fs.writeFile(path.join(root, ".env"), "OPENROUTER_KEY=sk-test\n");
  await fs.writeFile(path.join(root, "wide.txt"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hällo\nwelt", "utf16le")]));
  await fs.writeFile(path.join(root, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]));
  await fs.writeFile(path.join(outside, "secret.txt"), "outside");
  await fs.symlink(outside, path.join(root, "outside-link"), "junction");
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await fs.rm(outside, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("a text file is returned whole with line endings normalized", async () => {
  const view = await read_for_view(root, "src\\main.ts");
  assert.deepEqual(view, { kind: "text", path: "src/main.ts", size: 28, text: "const a = 1;\nconst b = 2;\n", truncated: false });
});

test("an empty file is an empty text view", async () => {
  await fs.writeFile(path.join(root, "empty.txt"), "");
  assert.deepEqual(await read_for_view(root, "empty.txt"), { kind: "text", path: "empty.txt", size: 0, text: "", truncated: false });
});

test("env files are shown like any other text file", async () => {
  const view = await read_for_view(root, ".env");
  assert.equal(view.kind, "text");
  assert.equal(view.kind === "text" && view.text, "OPENROUTER_KEY=sk-test\n");
});

test("UTF-16 files are decoded through the text codec", async () => {
  const view = await read_for_view(root, "wide.txt");
  assert.equal(view.kind === "text" && view.text, "hällo\nwelt");
});

test("binary files report their size instead of content", async () => {
  assert.deepEqual(await read_for_view(root, "image.png"), { kind: "binary", path: "image.png", size: 12 });
});

test("a file over the view limit is cut at the last whole line and marked truncated", async () => {
  const line = `${"x".repeat(99)}\n`;
  const count = Math.ceil((max_view_bytes * 1.5) / line.length);
  await fs.writeFile(path.join(root, "big.log"), line.repeat(count));
  const view = await read_for_view(root, "big.log");
  assert.equal(view.kind, "text");
  if (view.kind !== "text") {
    return;
  }
  assert.equal(view.truncated, true);
  assert.equal(view.size, line.length * count);
  assert.ok(view.text.length <= max_view_bytes);
  assert.ok(view.text.endsWith("\n"));
  assert.equal(view.text.length % line.length, 0);
});

test("a missing file is reported as missing, not as an error", async () => {
  assert.deepEqual(await read_for_view(root, "src/gone.ts"), { kind: "missing", path: "src/gone.ts" });
  assert.deepEqual(await read_for_view(root, "src/main.ts/inner"), { kind: "missing", path: "src/main.ts/inner" });
});

test("folders, empty paths and paths outside the project are refused", async () => {
  await assert.rejects(read_for_view(root, "src"), /is not a file/);
  await assert.rejects(read_for_view(root, ""), /file path is required/);
  await assert.rejects(read_for_view(root, "../x.txt"), /outside the project/);
  await assert.rejects(read_for_view(root, "outside-link/secret.txt"), /outside the project/);
});

test("a UTF-8 file cut inside a character stays UTF-8 and a Windows-1252 file shows its umlauts", async () => {
  const head = Buffer.from("Grüße\n", "utf8");
  const filler = Buffer.alloc(max_view_bytes - head.length - 1, 0x79);
  await fs.writeFile(path.join(root, "cut.txt"), Buffer.concat([head, filler, Buffer.from("ü\n", "utf8")]));
  const cut = await read_for_view(root, "cut.txt");
  assert.equal(cut.kind === "text" && cut.text, "Grüße\n");
  await fs.writeFile(path.join(root, "legacy.txt"), Buffer.from("caf\xe9\r\n", "latin1"));
  const legacy = await read_for_view(root, "legacy.txt");
  assert.equal(legacy.kind === "text" && legacy.text, "café\n");
});
