import path from "node:path";
import type { Attachment } from "../../../shared/chat.ts";
import { stored_attachment_path } from "../../media/files.ts";
import { readable_file } from "../fs/read.ts";

export type ViewTarget = { file: string; display: string };

const path_key = (value: string) => path.win32.normalize(value).toLowerCase();

export const view_target = async (attachments: Attachment[], project_root: string, raw: string): Promise<ViewTarget> => {
  const requested = raw.trim();
  if (path.win32.isAbsolute(requested)) {
    for (const attachment of attachments) {
      const stored = stored_attachment_path(attachment.id);
      if (stored && path_key(stored) === path_key(requested)) {
        return { file: stored, display: attachment.name };
      }
    }
  }
  const scoped = await readable_file(project_root, requested);
  return { file: scoped.target, display: scoped.relative };
};
