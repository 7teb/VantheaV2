import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { commit_edit, prepare_replace } from "../electron/project/edit.ts";
import { grep_project, grep_target } from "../electron/project/grep.ts";
import { read_text_window } from "../electron/project/text-window.ts";
import { decode_text, detect_encoding, encode_text, looks_binary, text_stream, type TextEncoding } from "../electron/storage/text-codec.ts";

const sample = "iterator type failed\r\nline two: Grüße ✓\r\nlast line";

const encodings: TextEncoding[] = [
  { charset: "utf8", bom: false },
  { charset: "utf8", bom: true },
  { charset: "utf16le", bom: true },
  { charset: "utf16be", bom: true },
  { charset: "utf16le", bom: false },
  { charset: "utf16be", bom: false },
];

let root = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-text-codec-"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const put = async (relative: string, bytes: Buffer) => {
  const file = path.join(root, "project", relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
  return file;
};

test("every encoding is detected, decoded without its BOM and written back byte for byte", () => {
  for (const encoding of encodings) {
    const bytes = encode_text(sample, encoding);
    const decoded = decode_text(bytes);
    assert.deepEqual(decoded.encoding, encoding, JSON.stringify(encoding));
    assert.equal(decoded.text, sample, JSON.stringify(encoding));
    assert.equal(looks_binary(decoded.text), false);
    assert.deepEqual(encode_text(decoded.text, decoded.encoding), bytes);
  }
});

test("a PowerShell log written as UTF-16 LE with BOM starts with FF FE", () => {
  const bytes = encode_text("iterator type", { charset: "utf16le", bom: true });
  assert.deepEqual([...bytes.subarray(0, 6)], [0xff, 0xfe, 0x69, 0x00, 0x74, 0x00]);
});

test("real binary data stays binary", () => {
  const bytes = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0xb8, 0x00]);
  const decoded = decode_text(bytes);
  assert.deepEqual(decoded.encoding, { charset: "windows1252", bom: false });
  assert.equal(looks_binary(decoded.text), true);
  assert.deepEqual(detect_encoding(Buffer.from([0x61, 0x00])), { charset: "utf8", bom: false });
});

test("streaming decodes UTF-16 correctly even when chunks split a character", async () => {
  const text = `${"abc ✓ grüße\n".repeat(50)}end`;
  for (const encoding of encodings) {
    const file = await put(`stream-${encoding.charset}-${encoding.bom}.txt`, encode_text(text, encoding));
    const { stream, encoding: found } = await text_stream(file, 3);
    let joined = "";
    for await (const chunk of stream as AsyncIterable<string>) {
      joined += chunk;
    }
    assert.deepEqual(found, encoding);
    assert.equal(joined, text, JSON.stringify(encoding));
  }
});

test("read_file windows and grep work on a UTF-16 log", async () => {
  const file = await put("logs/death.log", encode_text(sample, { charset: "utf16le", bom: true }));
  const window = await read_text_window(file, 1, 10, 10_000);
  assert.equal(window.binary, false);
  assert.equal(window.total_lines, 3);
  assert.equal(window.content, ["1: iterator type failed", "2: line two: Grüße ✓", "3: last line"].join("\n"));
  const result = await grep_project(await grep_target(path.join(root, "project"), "logs"), { query: "Grüße", path: "logs", regex: false, case_sensitive: true }, new AbortController().signal);
  assert.deepEqual(result.matches.map((match) => `${match.path}:${match.line}`), ["logs/death.log:2"]);
});

test("an edit keeps the file in UTF-16 with its BOM", async () => {
  const original = encode_text(sample, { charset: "utf16le", bom: true });
  const file = await put("edit/notes.log", original);
  const project = path.join(root, "project");
  await commit_edit(await prepare_replace(project, "edit/notes.log", "line two", "second line", 1));
  const edited = await fs.readFile(file);
  assert.deepEqual([...edited.subarray(0, 2)], [0xff, 0xfe]);
  assert.equal(decode_text(edited).text, sample.replace("line two", "second line"));
});
