import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { commit_edit, prepare_replace, prepare_write } from "../electron/project/edit.ts";
import { read_text_window } from "../electron/project/text-window.ts";
import { decode_head, decode_text, encode_text, text_stream } from "../electron/storage/text-codec.ts";

let root = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-cp1252-"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const latin = (text: string) => Buffer.from(text, "latin1");

const every_byte = Buffer.from(Array.from({ length: 255 }, (_, index) => index + 1));

const legacy_bytes = Buffer.concat([latin("label = Gr\xf6\xdfe, caf\xe9\r\n"), every_byte, latin("\r\nint x = 1;\r\n")]);

const put = async (name: string, bytes: Buffer) => {
  const file = path.join(root, name);
  await fs.writeFile(file, bytes);
  return file;
};

const streamed = async (file: string, chunk_bytes: number) => {
  const { stream, encoding } = await text_stream(file, chunk_bytes);
  let text = "";
  for await (const chunk of stream as AsyncIterable<string>) {
    text += chunk;
  }
  return { text, encoding };
};

test("bytes that are not UTF-8 decode as Windows-1252 and every byte encodes back unchanged", () => {
  const decoded = decode_text(legacy_bytes);
  assert.deepEqual(decoded.encoding, { charset: "windows1252", bom: false });
  assert.ok(decoded.text.startsWith("label = Größe, café\r\n"));
  const all = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
  const text = new TextDecoder("windows-1252").decode(all);
  assert.equal(text.charAt(0x80), "€");
  assert.equal(text.charAt(0x81), "\u0081");
  assert.equal(text.charAt(0x9f), "Ÿ");
  assert.deepEqual(encode_text(text, { charset: "windows1252", bom: false }), all);
});

test("an edit of a Windows-1252 file changes only the edited bytes", async () => {
  const file = await put("legacy.c", legacy_bytes);
  const prepared = await prepare_replace(root, "legacy.c", "int x = 1;", "int x = 2;", 1);
  assert.ok(prepared.previous?.startsWith("label = Größe, café\r\n"));
  assert.deepEqual([prepared.diff.added, prepared.diff.removed], [1, 1]);
  await commit_edit(prepared);
  const expected = Buffer.from(legacy_bytes);
  expected[legacy_bytes.lastIndexOf(0x31)] = 0x32;
  assert.deepEqual(await fs.readFile(file), expected);
});

test("write_file over a Windows-1252 file keeps the encoding", async () => {
  const file = await put("notes.txt", latin("caf\xe9\n"));
  await commit_edit(await prepare_write(root, "notes.txt", "Größe € café\n"));
  assert.deepEqual(await fs.readFile(file), latin("Gr\xf6\xdfe \x80 caf\xe9\n"));
});

test("a character Windows-1252 cannot encode fails the edit and writes nothing", async () => {
  const file = await put("strict.c", legacy_bytes);
  await assert.rejects(prepare_replace(root, "strict.c", "int x = 1;", "int x = 1; ✓", 1), /Windows-1252.*"✓" \(U\+2713\).*nothing was written/);
  await assert.rejects(prepare_write(root, "strict.c", "smile 😀"), /Windows-1252.*"😀" \(U\+1F600\)/);
  assert.deepEqual(await fs.readFile(file), legacy_bytes);
});

test("the read tool shows Windows-1252 text with its umlauts, even when the first non-ASCII byte is past the sniffed head", async () => {
  const file = await put("read.c", legacy_bytes);
  const window = await read_text_window(file, 1, 1, 10_000);
  assert.equal(window.content, "1: label = Größe, café");
  const late = Buffer.concat([Buffer.from(`${"a".repeat(5000)}\n`), latin("caf\xe9")]);
  const late_file = await put("late.txt", late);
  const result = await streamed(late_file, 7);
  assert.deepEqual(result.encoding, { charset: "windows1252", bom: false });
  assert.equal(result.text, `${"a".repeat(5000)}\ncafé`);
  assert.deepEqual(decode_text(late).encoding, { charset: "windows1252", bom: false });
});

test("a Windows-1252 file that ends in a byte that looks like a UTF-8 lead byte is still Windows-1252", async () => {
  const bytes = latin("caf\xe9");
  assert.equal(decode_text(bytes).text, "café");
  assert.equal((await streamed(await put("tail.txt", bytes), 2)).text, "café");
});

test("UTF-8 files keep decoding and encoding as UTF-8", async () => {
  const text = `${"x".repeat(5000)}\nGrüße ✓\n`;
  const file = await put("utf8.txt", Buffer.from(text, "utf8"));
  assert.deepEqual(decode_text(Buffer.from(text, "utf8")).encoding, { charset: "utf8", bom: false });
  assert.deepEqual(await streamed(file, 3), { text, encoding: { charset: "utf8", bom: false } });
  await commit_edit(await prepare_replace(root, "utf8.txt", "Grüße", "Größe", 1));
  assert.equal(await fs.readFile(file, "utf8"), text.replace("Grüße", "Größe"));
  const head = Buffer.from("ab ü", "utf8").subarray(0, 4);
  assert.deepEqual(decode_head(head).encoding, { charset: "utf8", bom: false });
  assert.deepEqual(decode_text(head).encoding, { charset: "windows1252", bom: false });
});
