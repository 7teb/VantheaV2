import { dialog } from "electron";
import fs from "node:fs/promises";
import type { AttachmentUpload } from "../../shared/ipc/media.ts";
import { main_window } from "../app/window.ts";
import { find_artifact, list_artifacts, update_artifact } from "../media/artifacts.ts";
import { is_media_id, read_attachment_text, resolve_media_file, save_attachment } from "../media/files.ts";
import { optional_boolean, optional_string, require_record, require_string } from "../storage/coerce.ts";
import { handle } from "./handle.ts";

const media_id = (value: unknown, label: string): string => {
  if (!is_media_id(value)) {
    throw new Error(`${label} is not a valid media id`);
  }
  return value;
};

const upload = (value: unknown): AttachmentUpload => {
  const raw = require_record(value, "attachment upload");
  if (!(raw.bytes instanceof Uint8Array)) {
    throw new Error("attachment upload bytes must be a Uint8Array");
  }
  return { name: require_string(raw.name, "attachment name", 1000), mime: require_string(raw.mime, "attachment mime", 200), bytes: raw.bytes };
};

const artifact_patch = (value: unknown) => {
  const raw = require_record(value, "artifact patch");
  return { title: optional_string(raw, "title", "artifact title"), pinned: optional_boolean(raw, "pinned", "artifact pinned") };
};

const export_artifact = async (artifact_id: string): Promise<boolean> => {
  if (!find_artifact(artifact_id)) {
    throw new Error(`artifact ${artifact_id} not found`);
  }
  const source = await resolve_media_file("image", artifact_id);
  const window = main_window();
  const options = { defaultPath: artifact_id };
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) {
    return false;
  }
  await fs.copyFile(source, result.filePath);
  return true;
};

export const register_media_ipc = () => {
  handle("attachments:save", (value) => save_attachment(upload(value)));
  handle("attachments:read_text", (id) => read_attachment_text(media_id(id, "attachment id")));
  handle("artifacts:list", (project_path) => list_artifacts(require_string(project_path, "project path", 2000)));
  handle("artifacts:update", (id, patch) => update_artifact(media_id(id, "artifact id"), artifact_patch(patch)));
  handle("artifacts:export", (id) => export_artifact(media_id(id, "artifact id")));
};
