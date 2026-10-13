import fs from "node:fs/promises";
import { edge_rule, fit_image, type NativeSize, type Size } from "../../shared/image-fit.ts";
import { image_url } from "../turn/carriers.ts";
import { image_size, resolve_media_file, sniff_image } from "./files.ts";

export type FittedImage = { url: string; size: Size | null; resized: boolean };

export const refittable = (mime: string): boolean => mime === "image/png" || mime === "image/jpeg";

const fitted_bytes = async (bytes: Buffer, mime: string, rules: NativeSize[]): Promise<FittedImage> => {
  const kind = sniff_image(bytes);
  const size = kind && refittable(kind.mime) ? image_size(bytes) : null;
  if (!size) {
    return { url: image_url(bytes, mime), size: null, resized: false };
  }
  const target = fit_image(size.width, size.height, rules);
  if (target.width === size.width && target.height === size.height) {
    return { url: image_url(bytes, mime), size, resized: false };
  }
  const { resized_copy } = await import("../browser/model-image.ts");
  const copy = resized_copy(bytes, target);
  return { url: image_url(copy.bytes, copy.ext === "png" ? "image/png" : "image/jpeg"), size: copy.size, resized: true };
};

const cache_chars = 64_000_000;

const resized_urls = new Map<string, string>();

let cached_chars = 0;

const remember_resized = (key: string, url: string) => {
  resized_urls.set(key, url);
  cached_chars += url.length;
  for (const [old, value] of resized_urls) {
    if (cached_chars <= cache_chars) {
      return;
    }
    resized_urls.delete(old);
    cached_chars -= value.length;
  }
};

export const fitted_image_url = async (id: string, mime: string, rules: NativeSize[]): Promise<string> => {
  const key = `${id}|${mime}|${JSON.stringify(rules)}`;
  const cached = resized_urls.get(key);
  if (cached !== undefined) {
    resized_urls.delete(key);
    resized_urls.set(key, cached);
    return cached;
  }
  const fitted = await fitted_bytes(await fs.readFile(await resolve_media_file("attachment", id)), mime, rules);
  if (fitted.resized) {
    remember_resized(key, fitted.url);
  }
  return fitted.url;
};

export const shrunk_data_url = async (url: string, edge: number): Promise<FittedImage | null> => {
  const comma = url.indexOf(",");
  const header = url.slice(0, comma);
  if (!header.startsWith("data:") || !header.endsWith(";base64")) {
    return null;
  }
  const bytes = Buffer.from(url.slice(comma + 1), "base64");
  try {
    const fitted = await fitted_bytes(bytes, header.slice("data:".length, -";base64".length), [edge_rule(edge)]);
    return fitted.resized ? fitted : null;
  } catch (error) {
    console.warn(`[media] scaling a ${bytes.length}-byte request image down to ${edge} px failed, it stays as it is:`, error);
    return null;
  }
};
