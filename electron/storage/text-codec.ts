import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { pipeline, Transform, type Readable } from "node:stream";

export type Charset = "utf8" | "utf16le" | "utf16be";

export type TextEncoding = { charset: Charset; bom: boolean };

export const plain_utf8: TextEncoding = { charset: "utf8", bom: false };

export const charsets: readonly Charset[] = ["utf8", "utf16le", "utf16be"];

const bom_bytes: Record<Charset, Buffer> = {
  utf8: Buffer.from([0xef, 0xbb, 0xbf]),
  utf16le: Buffer.from([0xff, 0xfe]),
  utf16be: Buffer.from([0xfe, 0xff]),
};

const sniff_bytes = 4096;

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
  if (charset === "utf16le") {
    return body.toString("utf16le");
  }
  if (charset === "utf16be") {
    return swap_pairs(body).toString("utf16le");
  }
  return body.toString("utf8");
};

export const decode_text = (bytes: Buffer): { text: string; encoding: TextEncoding } => {
  const encoding = detect_encoding(bytes.subarray(0, sniff_bytes));
  return { text: decode_body(bytes.subarray(bom_length(encoding)), encoding.charset), encoding };
};

export const encode_text = (text: string, encoding: TextEncoding): Buffer => {
  const body = encoding.charset === "utf8" ? Buffer.from(text, "utf8") : Buffer.from(text, "utf16le");
  const ordered = encoding.charset === "utf16be" ? swap_pairs(body) : body;
  return encoding.bom ? Buffer.concat([bom_bytes[encoding.charset], ordered]) : ordered;
};

export const looks_binary = (text: string): boolean => text.slice(0, 8192).includes("\u0000");

const read_head = async (file: string): Promise<Buffer> => {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(sniff_bytes);
    const { bytesRead } = await handle.read(buffer, 0, sniff_bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

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

export const text_stream = async (file: string, chunk_bytes = 64 * 1024): Promise<{ encoding: TextEncoding; stream: Readable }> => {
  const encoding = detect_encoding(await read_head(file));
  const raw = createReadStream(file, { start: bom_length(encoding), highWaterMark: chunk_bytes });
  if (encoding.charset !== "utf16be") {
    raw.setEncoding(encoding.charset);
    return { encoding, stream: raw };
  }
  const swapped = pipeline(raw, swap_stream(), (error) => {
    if (error && error.code !== "ERR_STREAM_PREMATURE_CLOSE") {
      console.error(`[text] decoding the UTF-16 BE file ${file} failed:`, error);
    }
  });
  swapped.setEncoding("utf16le");
  return { encoding, stream: swapped };
};
