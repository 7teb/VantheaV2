import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ApiContentPart, ApiMessage } from "../../model/types.ts";

export type UserBlock = Exclude<SDKUserMessage["message"]["content"], string>[number];

type ImageBlock = Extract<UserBlock, { type: "image" }>;

type Base64Source = Extract<ImageBlock["source"], { type: "base64" }>;

type ImageSource = { media_type: Base64Source["media_type"]; data: string };

const media_types: readonly Base64Source["media_type"][] = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export const image_marker = "[image not carried over]";

const data_url = /^data:([^;,]+);base64,(.*)$/s;

export const image_source = (url: string): ImageSource | null => {
  const match = data_url.exec(url);
  const media_type = media_types.find((type) => type === match?.[1]);
  return match && media_type ? { media_type, data: match[2] } : null;
};

const part_block = (part: ApiContentPart): UserBlock => {
  if (part.type === "text") {
    return { type: "text", text: part.text };
  }
  const source = image_source(part.image_url.url);
  return source ? { type: "image", source: { type: "base64", ...source } } : { type: "text", text: image_marker };
};

export const content_blocks = (content: string | ApiContentPart[]): UserBlock[] => {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  return content.map(part_block);
};

export const message_blocks = (message: ApiMessage): UserBlock[] => content_blocks(message.content ?? "");
