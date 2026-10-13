import type { ApiContentPart, ApiMessage, ApiUserMessage } from "../model/types.ts";

export type CarrierImage = { label: string; url: string } | { label: string; note: string };

export const not_shown_note = "The image is not shown because the current model does not take images.";

export const unreadable_note = "The image could not be read from disk.";

export const image_url = (bytes: Buffer, mime: string) => `data:${mime};base64,${bytes.toString("base64")}`;

const carrier_parts = (image: CarrierImage): ApiContentPart[] =>
  "url" in image
    ? [
        { type: "text", text: image.label },
        { type: "image_url", image_url: { url: image.url } },
      ]
    : [{ type: "text", text: `${image.label} ${image.note}` }];

export const carrier = (images: CarrierImage[]): ApiUserMessage => ({ role: "user", tool_images: true, content: images.flatMap(carrier_parts) });

export const without_images = (messages: ApiMessage[]): ApiMessage[] =>
  messages.map((message) => {
    if (message.role !== "user" || !Array.isArray(message.content) || !message.content.some((part) => part.type === "image_url")) {
      return message;
    }
    return { ...message, content: message.content.map((part): ApiContentPart => (part.type === "image_url" ? { type: "text", text: not_shown_note } : part)) };
  });
