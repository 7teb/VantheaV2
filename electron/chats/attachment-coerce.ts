import type { Attachment, AttachmentModel } from "../../shared/chat.ts";
import { is_media_id } from "../media/files.ts";
import { as_array, as_number, as_record, as_string } from "../storage/coerce.ts";

const dimension = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null);

const parse_model = (value: unknown): AttachmentModel | null => {
  const raw = as_record(value);
  const width = dimension(raw.width);
  const height = dimension(raw.height);
  return is_media_id(raw.id) && width !== null && height !== null ? { id: raw.id, width, height } : null;
};

const parse_attachment = (value: unknown): Attachment | null => {
  const raw = as_record(value);
  if (typeof raw.id !== "string" || (raw.kind !== "image" && raw.kind !== "file")) {
    return null;
  }
  const width = dimension(raw.width);
  const height = dimension(raw.height);
  const model = parse_model(raw.model);
  return {
    id: raw.id,
    kind: raw.kind,
    name: as_string(raw.name),
    mime: as_string(raw.mime),
    size: Math.max(0, Math.floor(as_number(raw.size, 0))),
    vision_note: typeof raw.vision_note === "string" ? raw.vision_note : null,
    ...(width !== null && height !== null ? { width, height } : {}),
    ...(model ? { model } : {}),
    ...(typeof raw.source_path === "string" ? { source_path: raw.source_path } : {}),
  };
};

export const parse_attachments = (value: unknown, chat_id: string): Attachment[] => {
  const entries = as_array(value);
  const parsed = entries.flatMap((entry) => parse_attachment(entry) ?? []);
  if (parsed.length < entries.length) {
    console.warn(`[chats] dropped ${entries.length - parsed.length} invalid attachment records in chat ${chat_id}`);
  }
  return parsed;
};
