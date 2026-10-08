import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Attachment } from "../../shared/chat.ts";
import { attachment_limits, type AttachmentUpload } from "../../shared/ipc/media.ts";
import { error_code } from "../storage/coerce.ts";
import { write_file_atomic } from "../storage/json-file.ts";
import { decode_text } from "../storage/text-codec.ts";

export type MediaBucket = "attachment" | "image";

export type MediaDirs = { attachments: string; images: string };

export type ImageKind = { ext: string; mime: string };

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

export const new_media_id = (prefix: "img" | "att", ext: string) =>
  `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}.${ext}`;

const display_name = (name: string, fallback: string) =>
  path.basename(name.replace(/[\u0000-\u001f\u007f]/g, "")).trim().slice(0, 200) || fallback;

const text_extension = (name: string) =>
  (path.extname(name).slice(1).toLowerCase().replace(/[^a-z0-9]/g, "") || "txt").slice(0, 8);

const text_mime = (declared: string) =>
  declared.startsWith("text/") || declared === "application/json" || declared === "application/xml" ? declared : "text/plain";

export const write_media = async (bucket: MediaBucket, id: string, bytes: Uint8Array) => {
  await write_file_atomic(media_path(bucket, id), bytes);
};

const save_image_attachment = async (upload: AttachmentUpload, kind: ImageKind): Promise<Attachment> => {
  if (upload.bytes.length > attachment_limits.image_bytes) {
    throw new Error("Image exceeds the 20 MB limit");
  }
  const id = new_media_id("img", kind.ext);
  await write_media("attachment", id, upload.bytes);
  return { id, kind: "image", name: display_name(upload.name, `image.${kind.ext}`), mime: kind.mime, size: upload.bytes.length, vision_note: null };
};

const save_text_attachment = async (upload: AttachmentUpload): Promise<Attachment> => {
  if (upload.bytes.length > attachment_limits.text_bytes) {
    throw new Error("File exceeds the 2 MB limit");
  }
  if (upload.bytes.includes(0)) {
    throw new Error("Not a text file");
  }
  const text = new TextDecoder("utf-8").decode(upload.bytes);
  const bytes = new TextEncoder().encode(text);
  const name = display_name(upload.name, "file.txt");
  const id = new_media_id("att", text_extension(name));
  await write_media("attachment", id, bytes);
  return { id, kind: "file", name, mime: text_mime(upload.mime), size: bytes.length, vision_note: null };
};

export const save_attachment = async (upload: AttachmentUpload): Promise<Attachment> => {
  if (!upload.bytes.length) {
    throw new Error("The file is empty");
  }
  if (!upload.mime.startsWith("image/")) {
    return save_text_attachment(upload);
  }
  const image = sniff_image(upload.bytes);
  if (!image) {
    throw new Error("Not a recognized image (expected PNG, JPEG, GIF, WebP, or BMP)");
  }
  return save_image_attachment(upload, image);
};

export const read_attachment_text = async (id: string): Promise<string> => {
  if (id.startsWith("img_")) {
    throw new Error(`attachment ${id} is an image, not a text file`);
  }
  return decode_text(await fs.readFile(await resolve_media_file("attachment", id))).text;
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
