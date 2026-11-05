import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { serve_check_request, serve_folder, stop_serving } from "../electron/check/serve.ts";

const setup = async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "vx-check-serve-")));
  const folder = path.join(root, "out", "page");
  await fs.mkdir(path.join(folder, "assets"), { recursive: true });
  await fs.writeFile(path.join(folder, "index.html"), "<h1>page</h1>");
  await fs.writeFile(path.join(folder, "app.js"), "init();");
  await fs.writeFile(path.join(folder, "base.css"), "body{}");
  await fs.writeFile(path.join(folder, "assets", "my font.woff2"), Buffer.from([1, 2, 3]));
  await fs.writeFile(path.join(folder, "data.bin"), Buffer.from([9]));
  await fs.writeFile(path.join(folder, ".env"), "KEY=1");
  await fs.writeFile(path.join(folder, "server.pem"), "pem");
  await fs.writeFile(path.join(root, "out", "secret.txt"), "outside the page folder");
  await fs.mkdir(path.join(root, "elsewhere"));
  await fs.writeFile(path.join(root, "elsewhere", "leak.js"), "leak");
  await fs.symlink(path.join(root, "elsewhere"), path.join(folder, "linked"), "junction");
  serve_folder("abc123", { folder, project_root: root });
  return { root, folder };
};

const get = (url: string, method = "GET") => serve_check_request(new Request(url, { method }));

test("files of the page folder are served with their content type, no caching and nosniff", async () => {
  await setup();
  const page = await get("vx-check://abc123/index.html");
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await page.text(), "<h1>page</h1>");
  assert.equal((await get("vx-check://abc123/app.js?v=2#x")).headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal((await get("vx-check://abc123/base.css")).headers.get("content-type"), "text/css; charset=utf-8");
  const font = await get("vx-check://abc123/assets/my%20font.woff2");
  assert.equal(font.headers.get("content-type"), "font/woff2");
  assert.deepEqual(new Uint8Array(await font.arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.equal((await get("vx-check://abc123/data.bin")).headers.get("content-type"), "application/octet-stream");
  const head = await get("vx-check://abc123/app.js", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "7");
  assert.equal(await head.text(), "");
  stop_serving("abc123");
});

test("paths out of the page folder, links out of it, secret names, folders, bad escapes and foreign tokens are refused", async () => {
  await setup();
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (const url of [
      "vx-check://abc123/../secret.txt",
      "vx-check://abc123/%2e%2e/secret.txt",
      "vx-check://abc123/..%5csecret.txt",
      "vx-check://abc123/..%2fsecret.txt",
      "vx-check://abc123/linked/leak.js",
      "vx-check://abc123/.env",
      "vx-check://abc123/server.pem",
      "vx-check://abc123/assets",
      "vx-check://abc123/missing.js",
      "vx-check://abc123/%E0%A4%A",
      "vx-check://other/index.html",
    ]) {
      assert.equal((await get(url)).status, 404, url);
    }
    assert.equal((await get("vx-check://abc123/index.html", "POST")).status, 405);
    stop_serving("abc123");
    assert.equal((await get("vx-check://abc123/index.html")).status, 404);
  } finally {
    console.warn = warn;
    stop_serving("abc123");
  }
});
