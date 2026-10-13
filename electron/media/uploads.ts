import type { Attachment } from "../../shared/chat.ts";
import { is_referenced } from "../chats/refs.ts";
import { delete_attachment } from "./files.ts";

const uploads = new Map<string, Attachment>();

const stored_ids = (attachment: Attachment): string[] => (attachment.model ? [attachment.id, attachment.model.id] : [attachment.id]);

export const remember_upload = (attachment: Attachment): Attachment => {
  uploads.set(attachment.id, attachment);
  return attachment;
};

export const uploaded = (ids: string[]): Attachment[] =>
  ids.map((id) => {
    const attachment = uploads.get(id);
    if (!attachment) {
      throw new Error(`attachment ${id} is not available, attach the file again`);
    }
    return attachment;
  });

export const session_upload_ids = (): Set<string> => new Set([...uploads.values()].flatMap(stored_ids));

export const discard_uploads = async (ids: string[]): Promise<void> => {
  for (const id of ids) {
    const attachment = uploads.get(id);
    if (!attachment || stored_ids(attachment).some(is_referenced)) {
      continue;
    }
    uploads.delete(id);
    for (const stored of stored_ids(attachment)) {
      try {
        await delete_attachment(stored);
      } catch (error) {
        console.error(`[media] discarding upload ${stored} (${attachment.name}) failed:`, error);
      }
    }
  }
};
