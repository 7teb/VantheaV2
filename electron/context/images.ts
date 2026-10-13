import type { Size } from "../../shared/image-fit.ts";
import { image_size, type ImageSize } from "../media/files.ts";
import { has_image_rules, max_edge, type ImageLimit } from "../model/image-limits.ts";
import type { ApiContentPart, ApiImagePart, ApiMessage } from "../model/types.ts";

export type ImageSlot = { message: number; part: number; carrier: boolean };

export const image_left_out_text = "[Image not sent: this request would exceed the provider's documented image or request size limit.]";

const size_prefix_chars = 349_528;

const sizes = new WeakMap<ApiImagePart, ImageSize | null>();

const content_of = (message: ApiMessage | undefined): ApiContentPart[] | null =>
  message?.role === "user" && Array.isArray(message.content) ? message.content : null;

export const image_slots = (messages: ApiMessage[]): ImageSlot[] =>
  messages.flatMap((message, index) =>
    (content_of(message) ?? []).flatMap((part, at) => (part.type === "image_url" ? [{ message: index, part: at, carrier: message.role === "user" && Boolean(message.tool_images) }] : [])),
  );

const slot_part = (messages: ApiMessage[], slot: ImageSlot): ApiContentPart | null => content_of(messages[slot.message])?.[slot.part] ?? null;

export const stub_image = (messages: ApiMessage[], slot: ImageSlot, text: string): number => {
  const content = content_of(messages[slot.message]);
  const before = content?.[slot.part];
  if (!content || before?.type !== "image_url") {
    return 0;
  }
  const after: ApiContentPart = { type: "text", text };
  content[slot.part] = after;
  return Buffer.byteLength(JSON.stringify(before)) - Buffer.byteLength(JSON.stringify(after));
};

export const drop_reasoning_after = (messages: ApiMessage[], index: number): void => {
  for (const message of messages.slice(index + 1)) {
    if (message.role === "assistant") {
      delete message.reasoning_details;
      delete message.reasoning;
    }
  }
};

const base64_of = (url: string): string | null => {
  const comma = url.indexOf(",");
  return url.startsWith("data:") && url.slice(0, comma).endsWith(";base64") ? url.slice(comma + 1) : null;
};

const decoded_length = (data: string): number => {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
};

const read_size = (data: string): ImageSize | null => {
  const head = image_size(Buffer.from(data.slice(0, size_prefix_chars), "base64"));
  return head ?? (data.length > size_prefix_chars ? image_size(Buffer.from(data, "base64")) : null);
};

const part_size = (part: ApiImagePart): ImageSize | null => {
  if (!sizes.has(part)) {
    const data = base64_of(part.image_url.url);
    sizes.set(part, data ? read_size(data) : null);
  }
  return sizes.get(part) ?? null;
};

const breaks_image_rule = (part: ApiImagePart, limit: ImageLimit, edge: number | null): boolean => {
  const url = part.image_url.url;
  if (limit.max_encoded_bytes !== null && url.length > limit.max_encoded_bytes) {
    return true;
  }
  const data = base64_of(url);
  if (limit.max_decoded_bytes !== null && data !== null && decoded_length(data) > limit.max_decoded_bytes) {
    return true;
  }
  const size = edge === null ? null : part_size(part);
  return size !== null && edge !== null && Math.max(size.width, size.height) > edge;
};

export type ImageShrinker = (url: string, edge: number) => Promise<{ url: string; size: Size | null } | null>;

type Shrunk = { url: string; size: Size | null };

const byte_reasons = (url: string, limit: ImageLimit): { ratio: number; reason: string }[] => {
  const reasons: { ratio: number; reason: string }[] = [];
  if (limit.max_encoded_bytes !== null && url.length > limit.max_encoded_bytes) {
    reasons.push({ ratio: limit.max_encoded_bytes / url.length, reason: `the provider accepts at most ${limit.max_encoded_bytes} bytes of encoded data per image` });
  }
  const data = base64_of(url);
  const decoded = data === null ? 0 : decoded_length(data);
  if (limit.max_decoded_bytes !== null && decoded > limit.max_decoded_bytes) {
    reasons.push({ ratio: limit.max_decoded_bytes / decoded, reason: `the provider accepts at most ${limit.max_decoded_bytes} bytes per image` });
  }
  return reasons;
};

const smaller_image = async (url: string, long_edge: number, wanted: number, limit: ImageLimit, shrink: ImageShrinker): Promise<Shrunk | null> => {
  const ratios = byte_reasons(url, limit).map((entry) => entry.ratio);
  for (let edge = Math.min(wanted, ratios.length ? Math.floor(long_edge * Math.sqrt(Math.min(...ratios)) * 0.9) : long_edge); edge > 0; edge = Math.floor(edge * 0.8)) {
    const shrunk = await shrink(url, edge);
    if (!shrunk || !byte_reasons(shrunk.url, limit).length) {
      return shrunk;
    }
  }
  return null;
};

const scaled_note = (from: ImageSize, to: Size | null, reasons: string[]) =>
  `[The image above was scaled down from ${from.width}x${from.height} px${to ? ` to ${to.width}x${to.height} px` : ""}: ${reasons.join("; ")}.]`;

export const shrink_images = async (messages: ApiMessage[], limit: ImageLimit, shrink: ImageShrinker, bound_to_prefix: boolean): Promise<boolean> => {
  if (!has_image_rules(limit)) {
    return false;
  }
  const slots = image_slots(messages);
  const edge = max_edge(limit, slots.length);
  let first: number | null = null;
  for (const slot of slots.toReversed()) {
    const content = content_of(messages[slot.message]);
    const part = content?.[slot.part];
    if (!content || part?.type !== "image_url") {
      continue;
    }
    const size = part_size(part);
    if (!size) {
      continue;
    }
    const long_edge = Math.max(size.width, size.height);
    const over_edge = edge !== null && long_edge > edge;
    const reasons = [
      ...(over_edge ? [`with ${slots.length} images in one request the provider accepts at most ${edge} px per side`] : []),
      ...byte_reasons(part.image_url.url, limit).map((entry) => entry.reason),
    ];
    if (!reasons.length) {
      continue;
    }
    const shrunk = await smaller_image(part.image_url.url, long_edge, over_edge ? edge : long_edge, limit, shrink);
    if (!shrunk) {
      continue;
    }
    content.splice(slot.part, 1, { type: "image_url", image_url: { url: shrunk.url } }, { type: "text", text: scaled_note(size, shrunk.size, reasons) });
    first = Math.min(first ?? slot.message, slot.message);
  }
  if (first === null) {
    return false;
  }
  if (bound_to_prefix) {
    drop_reasoning_after(messages, first);
  }
  return true;
};

export const fit_images = (messages: ApiMessage[], limit: ImageLimit, measure: () => number, bound_to_prefix: boolean): boolean => {
  if (!has_image_rules(limit)) {
    return false;
  }
  const live = image_slots(messages);
  const removed: ImageSlot[] = [];
  const remove = (slot: ImageSlot): number => {
    live.splice(live.indexOf(slot), 1);
    removed.push(slot);
    return stub_image(messages, slot, image_left_out_text);
  };
  const find_broken = () => {
    const edge = max_edge(limit, live.length);
    return live.find((slot) => {
      const part = slot_part(messages, slot);
      return part?.type === "image_url" && breaks_image_rule(part, limit, edge);
    });
  };
  for (let broken = find_broken(); broken; broken = find_broken()) {
    remove(broken);
  }
  let body = limit.max_request_bytes === null ? 0 : measure();
  const over = () => (limit.max_images !== null && live.length > limit.max_images) || (limit.max_request_bytes !== null && body > limit.max_request_bytes);
  for (const slot of [...live.filter((entry) => entry.carrier), ...live.filter((entry) => !entry.carrier)]) {
    if (!over()) {
      break;
    }
    body -= remove(slot);
  }
  if (!removed.length) {
    return false;
  }
  if (bound_to_prefix) {
    drop_reasoning_after(messages, Math.min(...removed.map((slot) => slot.message)));
  }
  return true;
};
