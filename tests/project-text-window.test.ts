import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { max_line_chars, read_text_window } from "../electron/project/text-window.ts";

let root = "";

const file = async (name: string, content: string | Buffer) => {
  const target = path.join(root, name);
  await fs.writeFile(target, content);
  return target;
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-text-window-"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("a window returns numbered lines and the total line count", async () => {
  const target = await file("normal.txt", [...Array(10000).keys()].map((index) => `line-${index + 1}`).join("\n"));
  const window = await read_text_window(target, 500, 20, 25000);
  assert.deepEqual([window.start_line, window.end_line, window.total_lines, window.truncated], [500, 519, 10000, false]);
  assert.match(window.content, /^500: line-500/);
  assert.match(window.content, /519: line-519$/);
});

test("a trailing newline does not count as an extra line", async () => {
  assert.equal((await read_text_window(await file("trailing.txt", "a\nb\n"), 1, 100, 25000)).total_lines, 2);
  assert.equal((await read_text_window(await file("crlf.txt", "a\r\nb\r\n"), 1, 100, 25000)).content, "1: a\n2: b");
  assert.equal((await read_text_window(await file("no-trailing.txt", "a\nb"), 1, 100, 25000)).total_lines, 2);
  assert.equal((await read_text_window(await file("blank-last.txt", "a\n\n"), 1, 100, 25000)).total_lines, 2);
  assert.equal((await read_text_window(await file("empty.txt", ""), 1, 100, 25000)).total_lines, 0);
});

test("an overlong line is cut with a visible marker instead of failing the read", async () => {
  const target = await file("long.txt", `${"a".repeat(180000)}\nneedle`);
  const window = await read_text_window(target, 1, 2, 25000);
  assert.equal(window.truncated, false);
  assert.equal(window.total_lines, 2);
  const [first, second] = window.content.split("\n");
  assert.ok(first?.startsWith(`1: ${"a".repeat(max_line_chars)} ... [line cut at ${max_line_chars} characters]`));
  assert.equal(second, "2: needle");
  const after_long = await read_text_window(target, 2, 1, 25000);
  assert.equal(after_long.content, "2: needle");
});

test("the token budget truncates the window and reports where it stopped", async () => {
  const target = await file("tokens.txt", [...Array(100).keys()].map(() => "z".repeat(1000)).join("\n"));
  const window = await read_text_window(target, 1, 100, 500);
  assert.equal(window.truncated, true);
  assert.equal(window.total_lines, 100);
  assert.ok(window.content.length < 3000);
  assert.equal(window.end_line, window.content.split("\n").length);
});

test("binary files are detected", async () => {
  const window = await read_text_window(await file("blob.bin", Buffer.from([0x4d, 0x5a, 0, 0, 3])), 1, 10, 25000);
  assert.equal(window.binary, true);
});
