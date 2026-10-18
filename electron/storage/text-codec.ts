import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { pipeline, Transform, type Readable } from "node:stream";
import { error_code } from "./coerce.ts";

type UnicodeCharset = "utf8" | "utf16le" | "utf16be";

export type Charset = UnicodeCharset | "windows1252";

export type TextEncoding = { charset: UnicodeCharset; bom: boolean } | { charset: "windows1252"; bom: false };

export const plain_utf8: TextEncoding = { charset: "utf8", bom: false };

const windows_1252: TextEncoding = { charset: "windows1252", bom: false };

const charsets: readonly UnicodeCharset[] = ["utf8", "utf16le", "utf16be"];

const bom_bytes: Record<UnicodeCharset, Buffer> = {
  utf8: Buffer.from([0xef, 0xbb, 0xbf]),
  utf16le: Buffer.from([0xff, 0xfe]),
  utf16be: Buffer.from([0xfe, 0xff]),
};

const sniff_bytes = 4096;

const invalid_utf8 = "ERR_ENCODING_INVALID_ENCODED_DATA";

const cp1252_decoder = new TextDecoder("windows-1252");

const cp1252_bytes = new Map([...cp1252_decoder.decode(Uint8Array.from({ length: 256 }, (_, byte) => byte))].map((char, byte) => [char, byte]));

const starts_with = (bytes: Uint8Array, prefix: Buffer) => prefix.every((byte, index) => bytes[index] === byte);

const zero_share = (bytes: Uint8Array, parity: number): number => {
  let zeros = 0;
  let total = 0;
  for (let index = parity; index < bytes.length; index += 2) {
    total += 1;
    if (bytes[index] === 0) {
      zeros += 1;
    }
  }
  return total ? zeros / total : 0;
};

const is_plain_utf8 = (encoding: TextEncoding) => encoding.charset === "utf8" && !encoding.bom;

const valid_utf8 = (bytes: Uint8Array, complete: boolean): boolean => {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: !complete });
    return true;
  } catch (error) {
    if (error_code(error) !== invalid_utf8) {
      throw error;
    }
    return false;
  }
};

const valid_utf8_file = async (file: string): Promise<boolean> => {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for await (const chunk of createReadStream(file)) {
      decoder.decode(chunk as Buffer, { stream: true });
    }
    decoder.decode();
    return true;
  } catch (error) {
    if (error_code(error) !== invalid_utf8) {
      throw error;
    }
    return false;
  }
};

export const detect_encoding = (head: Uint8Array): TextEncoding => {
  for (const charset of charsets) {
    if (starts_with(head, bom_bytes[charset])) {
      return { charset, bom: true };
    }
  }
  if (head.length < 4) {
    return plain_utf8;
  }
  const even = zero_share(head, 0);
  const odd = zero_share(head, 1);
  if (odd >= 0.9 && even <= 0.1) {
    return { charset: "utf16le", bom: false };
  }
  if (even >= 0.9 && odd <= 0.1) {
    return { charset: "utf16be", bom: false };
  }
  return plain_utf8;
};

const bom_length = (encoding: TextEncoding) => (encoding.bom ? bom_bytes[encoding.charset].length : 0);

const swap_pairs = (bytes: Buffer): Buffer => {
  const out = Buffer.alloc(bytes.length - (bytes.length % 2));
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    out[index] = bytes[index + 1] ?? 0;
    out[index + 1] = bytes[index] ?? 0;
  }
  return out;
};

const decode_body = (body: Buffer, charset: Charset): string => {
  if (charset === "windows1252") {
    return cp1252_decoder.decode(body);
  }
  if (charset === "utf16le") {
    return body.toString("utf16le");
  }
  if (charset === "utf16be") {
    return swap_pairs(body).toString("utf16le");
  }
  return body.toString("utf8");
};

export const bytes_encoding = (bytes: Uint8Array): TextEncoding => detect_encoding(bytes.subarray(0, sniff_bytes));

const decode_bytes = (bytes: Buffer, complete: boolean): { text: string; encoding: TextEncoding } => {
  const sniffed = bytes_encoding(bytes);
  const encoding = is_plain_utf8(sniffed) && !valid_utf8(bytes, complete) ? windows_1252 : sniffed;
  return { text: decode_body(bytes.subarray(bom_length(encoding)), encoding.charset), encoding };
};

export const decode_text = (bytes: Buffer): { text: string; encoding: TextEncoding } => decode_bytes(bytes, true);

export const decode_head = (head: Buffer): { text: string; encoding: TextEncoding } => decode_bytes(head, false);

const encode_cp1252 = (text: string): Buffer => {
  const out = Buffer.alloc(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const byte = cp1252_bytes.get(text.charAt(index));
    if (byte === undefined) {
      const point = text.codePointAt(index) ?? 0;
      const code = point.toString(16).toUpperCase().padStart(4, "0");
      throw new Error(`The file is Windows-1252, which cannot encode "${String.fromCodePoint(point)}" (U+${code}); nothing was written`);
    }
    out[index] = byte;
  }
  return out;
};

export const encode_text = (text: string, encoding: TextEncoding): Buffer => {
  if (encoding.charset === "windows1252") {
    return encode_cp1252(text);
  }
  const body = encoding.charset === "utf8" ? Buffer.from(text, "utf8") : Buffer.from(text, "utf16le");
  const ordered = encoding.charset === "utf16be" ? swap_pairs(body) : body;
  return encoding.bom ? Buffer.concat([bom_bytes[encoding.charset], ordered]) : ordered;
};

export const looks_binary = (text: string): boolean => text.slice(0, 8192).includes("\u0000");

export const read_head = async (file: string, length = sniff_bytes): Promise<Buffer> => {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

const cp1252_stream = () =>
  new Transform({
    transform(chunk: Buffer, _encoding, done) {
      done(null, Buffer.from(cp1252_decoder.decode(chunk), "utf8"));
    },
  });

const swap_stream = () => {
  let carry: Buffer | null = null;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      const bytes = carry ? Buffer.concat([carry, chunk]) : chunk;
      const even = bytes.length - (bytes.length % 2);
      carry = even < bytes.length ? bytes.subarray(even) : null;
      done(null, swap_pairs(bytes.subarray(0, even)));
    },
  });
};

const file_encoding = async (file: string): Promise<TextEncoding> => {
  const sniffed = detect_encoding(await read_head(file));
  return is_plain_utf8(sniffed) && !(await valid_utf8_file(file)) ? windows_1252 : sniffed;
};

export const text_stream = async (file: string, chunk_bytes = 64 * 1024): Promise<{ encoding: TextEncoding; stream: Readable }> => {
  const encoding = await file_encoding(file);
  const raw = createReadStream(file, { start: bom_length(encoding), highWaterMark: chunk_bytes });
  if (encoding.charset === "utf8" || encoding.charset === "utf16le") {
    raw.setEncoding(encoding.charset);
    return { encoding, stream: raw };
  }
  const decoded = pipeline(raw, encoding.charset === "utf16be" ? swap_stream() : cp1252_stream(), (error) => {
    if (error && error.code !== "ERR_STREAM_PREMATURE_CLOSE") {
      console.error(`[text] decoding ${file} as ${encoding.charset} failed:`, error);
    }
  });
  decoded.setEncoding(encoding.charset === "utf16be" ? "utf16le" : "utf8");
  return { encoding, stream: decoded };
};
