import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Attachment } from "../../shared/chat.ts";
import { attachment_limits, type AttachmentUpload } from "../../shared/ipc/media.ts";
import { error_code, error_text } from "../storage/coerce.ts";
import { write_file_atomic } from "../storage/json-file.ts";
import { bytes_encoding, decode_text } from "../storage/text-codec.ts";

export type MediaBucket = "attachment" | "image";

export type MediaDirs = { attachments: string; images: string };

export type ImageKind = { ext: string; mime: string };

export type ImageSize = { width: number; height: number };

const media_id_pattern = /^(?:img|att)_[a-z0-9]+_[a-z0-9]+\.[a-z0-9]{1,8}$/;

const image_mimes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

let dirs: MediaDirs | null = null;

export const init_media = (value: MediaDirs) => {
  dirs = value;
};

const media_dirs = (): MediaDirs => {
  if (!dirs) {
    throw new Error("media used before init_media");
  }
  return dirs;
};

export const is_media_id = (value: unknown): value is string => typeof value === "string" && media_id_pattern.test(value);

const media_dir = (bucket: MediaBucket): string => (bucket === "attachment" ? media_dirs().attachments : media_dirs().images);

export const media_path = (bucket: MediaBucket, id: string): string => {
  if (!is_media_id(id)) {
    throw new Error(`invalid media id ${JSON.stringify(id).slice(0, 80)}`);
  }
  return path.join(media_dir(bucket), id);
};

export const stored_attachment_path = (id: string): string | null => (is_media_id(id) ? media_path("attachment", id) : null);

export const resolve_media_file = async (bucket: MediaBucket, id: string): Promise<string> => {
  const dir = await fs.realpath(media_dir(bucket));
  const real = await fs.realpath(media_path(bucket, id));
  const relative = path.relative(dir, real);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`media file ${id} resolves outside the ${bucket} folder`);
  }
  return real;
};

export const media_mime = (id: string): string => image_mimes[path.extname(id).slice(1).toLowerCase()] ?? "text/plain; charset=utf-8";

const bmp_info_sizes = new Set([12, 40, 52, 56, 64, 108, 124]);

const is_bmp = (bytes: Uint8Array): boolean => {
  if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pixel_offset = view.getUint32(10, true);
  const info_size = view.getUint32(14, true);
  return bmp_info_sizes.has(info_size) && pixel_offset >= 14 + info_size && pixel_offset <= bytes.length;
};

export const sniff_image = (bytes: Uint8Array): ImageKind | null => {
  if (bytes.length < 12) {
    return null;
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: "png", mime: "image/png" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  const head = String.fromCharCode(...bytes.subarray(0, 6));
  if (head === "GIF87a" || head === "GIF89a") {
    return { ext: "gif", mime: "image/gif" };
  }
  const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  if (riff && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { ext: "webp", mime: "image/webp" };
  }
  if (is_bmp(bytes)) {
    return { ext: "bmp", mime: "image/bmp" };
  }
  return null;
};

const png_size = (view: DataView): ImageSize | null => (view.byteLength >= 24 ? { width: view.getUint32(16), height: view.getUint32(20) } : null);

const jpeg_standalone = (marker: number) => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);

const jpeg_frame = (marker: number) => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

const jpeg_size = (view: DataView): ImageSize | null => {
  let at = 2;
  while (at + 4 <= view.byteLength) {
    if (view.getUint8(at) !== 0xff) {
      return null;
    }
    const marker = view.getUint8(at + 1);
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (jpeg_standalone(marker)) {
      at += 2;
      continue;
    }
    if (jpeg_frame(marker)) {
      return at + 9 <= view.byteLength ? { width: view.getUint16(at + 7), height: view.getUint16(at + 5) } : null;
    }
    at += 2 + view.getUint16(at + 2);
  }
  return null;
};

const webp_size = (view: DataView, bytes: Uint8Array): ImageSize | null => {
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8 " && view.byteLength >= 30) {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (chunk === "VP8L" && view.byteLength >= 25) {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X" && view.byteLength >= 31) {
    return { width: (view.getUint32(24, true) & 0xffffff) + 1, height: (view.getUint32(27, true) & 0xffffff) + 1 };
  }
  return null;
};

const bmp_size = (view: DataView): ImageSize => {
  if (view.getUint32(14, true) === 12) {
    return { width: view.getUint16(18, true), height: view.getUint16(20, true) };
  }
  return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) };
};

export const image_size = (bytes: Uint8Array): ImageSize | null => {
  const kind = sniff_image(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (kind?.ext) {
    case "png":
      return png_size(view);
    case "jpg":
      return jpeg_size(view);
    case "gif":
      return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    case "webp":
      return webp_size(view, bytes);
    case "bmp":
      return bmp_size(view);
    default:
      return null;
  }
};

export const new_media_id = (prefix: "img" | "att", ext: string) =>
  `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}.${ext}`;

const display_name = (name: string, fallback: string) =>
  path.basename(name.replace(/[\u0000-\u001f\u007f]/g, "")).trim().slice(0, 200) || fallback;

const secret_extensions = new Set(["pem", "key", "p12", "pfx", "ssh"]);

const stored_extension = (name: string, binary: boolean) => {
  const ext = path.extname(name).slice(1).toLowerCase().replace(/[^a-z0-9]/g, "");
  return !ext || secret_extensions.has(ext) ? (binary ? "bin" : "txt") : ext.slice(0, 8);
};

const is_text_mime = (mime: string) => mime.startsWith("text/") || mime === "application/json" || mime === "application/xml";

const text_mime = (declared: string) => (is_text_mime(declared) ? declared : "text/plain");

const binary_mime = (declared: string) => {
  const mime = declared.toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime) && !is_text_mime(mime) ? mime : "application/octet-stream";
};

export const is_text_attachment = (attachment: Attachment): boolean => attachment.kind === "file" && is_text_mime(attachment.mime);

const is_text = (bytes: Uint8Array): boolean => bytes_encoding(bytes).charset !== "utf8" || !bytes.includes(0);

export const write_media = async (bucket: MediaBucket, id: string, bytes: Uint8Array) => {
  await write_file_atomic(media_path(bucket, id), bytes);
};

const image_ext = (mime: string): string => {
  const found = Object.entries(image_mimes).find(([, value]) => value === mime);
  if (!found) {
    throw new Error(`a tool image of type ${mime} has no image file extension`);
  }
  return found[0];
};

export const save_tool_images = async (images: { bytes: Buffer; mime: string }[]): Promise<string[]> => {
  const written: string[] = [];
  try {
    for (const image of images) {
      const id = new_media_id("img", image_ext(image.mime));
      await write_media("attachment", id, image.bytes);
      written.push(id);
    }
    return written;
  } catch (error) {
    for (const id of written) {
      await delete_attachment(id).catch((cleanup: unknown) => console.error(`[media] removing tool image ${id} after a failed save failed:`, cleanup));
    }
    throw error;
  }
};

const source_location = async (upload: AttachmentUpload): Promise<{ source_path?: string }> => {
  const source = upload.source_path;
  if (!source) {
    return {};
  }
  try {
    if (path.isAbsolute(source) && (await fs.stat(source)).size === upload.bytes.length) {
      return { source_path: source };
    }
    console.warn(`[media] dropping the source path ${source} of upload ${upload.name}: not absolute or its size differs from the ${upload.bytes.length} uploaded bytes`);
  } catch (error) {
    console.warn(`[media] dropping the source path ${source} of upload ${upload.name}: ${error_text(error)}`);
  }
  return {};
};

const save_image_attachment = async (upload: AttachmentUpload, kind: ImageKind): Promise<Attachment> => {
  if (upload.bytes.length > attachment_limits.image_bytes) {
    throw new Error("Image exceeds the 20 MB limit");
  }
  const source = await source_location(upload);
  const id = new_media_id("img", kind.ext);
  await write_media("attachment", id, upload.bytes);
  const size = image_size(upload.bytes);
  const name = display_name(upload.name, `image.${kind.ext}`);
  return { id, kind: "image", name, mime: kind.mime, size: upload.bytes.length, vision_note: null, ...(size ? { width: size.width, height: size.height } : {}), ...source };
};

const save_file_attachment = async (upload: AttachmentUpload): Promise<Attachment> => {
  if (upload.bytes.length > attachment_limits.file_bytes) {
    throw new Error("File exceeds the 20 MB limit");
  }
  const source = await source_location(upload);
  const text = is_text(upload.bytes);
  const name = display_name(upload.name, text ? "file.txt" : "file.bin");
  const id = new_media_id("att", stored_extension(name, !text));
  await write_media("attachment", id, upload.bytes);
  return { id, kind: "file", name, mime: text ? text_mime(upload.mime) : binary_mime(upload.mime), size: upload.bytes.length, vision_note: null, ...source };
};

export const save_attachment = async (upload: AttachmentUpload): Promise<Attachment> => {
  if (!upload.bytes.length) {
    throw new Error("The file is empty");
  }
  const image = upload.mime.startsWith("image/") ? sniff_image(upload.bytes) : null;
  return image ? save_image_attachment(upload, image) : save_file_attachment(upload);
};

export const read_attachment_text = async (id: string): Promise<string> => {
  if (id.startsWith("img_")) {
    throw new Error(`attachment ${id} is an image, not a text file`);
  }
  const bytes = await fs.readFile(await resolve_media_file("attachment", id));
  if (!is_text(bytes)) {
    throw new Error(`attachment ${id} is a binary file, not a text file`);
  }
  return decode_text(bytes).text;
};

export const delete_attachment = async (id: string) => {
  try {
    await fs.unlink(media_path("attachment", id));
  } catch (error) {
    if (error_code(error) === "ENOENT") {
      return;
    }
    throw error;
  }
};

export const list_media = async (bucket: MediaBucket): Promise<{ id: string; modified_ms: number }[]> => {
  const dir = media_dir(bucket);
  const files: { id: string; modified_ms: number }[] = [];
  for (const name of await fs.readdir(dir)) {
    if (!is_media_id(name)) {
      continue;
    }
    try {
      const stat = await fs.stat(path.join(dir, name));
      if (stat.isFile()) {
        files.push({ id: name, modified_ms: stat.mtimeMs });
      }
    } catch (error) {
      if (error_code(error) !== "ENOENT") {
        throw error;
      }
    }
  }
  return files;
};

export const media_exists = async (bucket: MediaBucket, id: string): Promise<boolean> => {
  try {
    await fs.access(media_path(bucket, id));
    return true;
  } catch (error) {
    if (error_code(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
};
