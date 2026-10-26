import { createHash } from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import fs from "node:fs/promises";
import { error_code, missing_path } from "../storage/coerce.ts";
import { path_key } from "../storage/paths.ts";
import { decode_head, decode_text, looks_binary, read_head } from "../storage/text-codec.ts";

export const read_limit_bytes = 1048576;

export type ScriptPin = { path: string; sha256: string | null };

export type PinChange = { path: string; before: string | null; after: string | null };

export type SourceRead = { sha256: string; bytes: number; mtime: number; birthtime: number; text: string | null; binary: boolean; over_limit: boolean };

const sha256_of = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

export const file_sha256 = async (file: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, { highWaterMark: read_limit_bytes })) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
};

export const read_source = async (file: string): Promise<SourceRead> => {
  const stat = await fs.stat(file);
  if (stat.size > read_limit_bytes) {
    const head = decode_head(await read_head(file)).text;
    return { sha256: await file_sha256(file), bytes: stat.size, mtime: stat.mtimeMs, birthtime: stat.birthtimeMs, text: null, binary: looks_binary(head), over_limit: true };
  }
  const bytes = await fs.readFile(file);
  const { text } = decode_text(bytes);
  const binary = looks_binary(text);
  return { sha256: sha256_of(bytes), bytes: bytes.length, mtime: stat.mtimeMs, birthtime: stat.birthtimeMs, text: binary ? null : text, binary, over_limit: false };
};

export const stat_optional = async (file: string, purpose: string): Promise<Stats | null> => {
  try {
    return await fs.stat(file);
  } catch (error) {
    if (!missing_path(error)) {
      console.warn(`[permissions] checking ${file} for ${purpose} failed: ${error_code(error) || String(error)}`);
    }
    return null;
  }
};

const current_sha256 = async (file: string): Promise<string | null> => {
  try {
    return await file_sha256(file);
  } catch (error) {
    if (error_code(error) !== "ENOENT" && error_code(error) !== "EISDIR") {
      console.warn(`[permissions] rehashing ${file} before execution failed, treating it as changed: ${error_code(error) || String(error)}`);
    }
    return null;
  }
};

export const changed_pins = async (pins: ScriptPin[]): Promise<PinChange[]> => {
  const changes: PinChange[] = [];
  for (const pin of pins) {
    const after = await current_sha256(pin.path);
    if (after !== pin.sha256) {
      changes.push({ path: pin.path, before: pin.sha256, after });
    }
  }
  return changes;
};

export const pins_digest = (pins: ScriptPin[]): string =>
  sha256_of(
    Buffer.from(
      pins
        .map((pin) => `${path_key(pin.path)}\n${pin.sha256 ?? "absent"}`)
        .sort()
        .join("\n"),
    ),
  );
