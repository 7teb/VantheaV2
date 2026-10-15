import type { Attachment } from "../../../shared/chat.ts";

export const attachment_src = (attachment: Attachment) => `vx-media://attachment/${attachment.id}`;

export const attachment_thumb_src = (attachment: Attachment) => `vx-media://attachment/${attachment.model?.id ?? attachment.id}`;

export const image_src = (image_id: string) => `vx-media://image/${image_id}`;

export const favicon_src = (host: string) => `vx-media://favicon/${host}`;

export const format_size = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
