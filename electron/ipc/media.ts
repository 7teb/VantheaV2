import { dialog } from "electron";
import fs from "node:fs/promises";
import type { Attachment } from "../../shared/chat.ts";
import { attachment_limits, dictation_limit_bytes, type AttachmentUpload } from "../../shared/ipc/media.ts";
import { main_window } from "../app/window.ts";
import { find_artifact, list_artifacts, update_artifact } from "../media/artifacts.ts";
import { transcribe } from "../media/dictation.ts";
import { model_catalog } from "../model/catalog-file.ts";
import { is_media_id, read_attachment_text, resolve_media_file, save_attachment } from "../media/files.ts";
import { save_model_copy } from "../media/model-copy.ts";
import { discard_uploads, remember_upload } from "../media/uploads.ts";
import { as_array, optional_boolean, optional_string, require_record, require_string } from "../storage/coerce.ts";
import { handle } from "./handle.ts";

const media_id = (value: unknown, label: string): string => {
  if (!is_media_id(value)) {
    throw new Error(`${label} is not a valid media id`);
  }
  return value;
};

export const parse_ids = (value: unknown): string[] => {
  const ids = as_array(value);
  if (ids.length > attachment_limits.max_files) {
    throw new Error(`${ids.length} attachments, at most ${attachment_limits.max_files} are allowed`);
  }
  return ids.map((id) => media_id(id, "attachment id"));
};

const upload = (value: unknown): AttachmentUpload => {
  const raw = require_record(value, "attachment upload");
  if (!(raw.bytes instanceof Uint8Array)) {
    throw new Error("attachment upload bytes must be a Uint8Array");
  }
  if (raw.model_source !== undefined && !(raw.model_source instanceof Uint8Array)) {
    throw new Error("attachment model source must be a Uint8Array");
  }
  return {
    name: require_string(raw.name, "attachment name", 1000),
    mime: require_string(raw.mime, "attachment mime", 200),
    bytes: raw.bytes,
    ...(raw.model_source ? { model_source: raw.model_source } : {}),
    ...(raw.source_path !== undefined ? { source_path: require_string(raw.source_path, "attachment source path", 1000) } : {}),
  };
};

const dictation_audio = (value: unknown): Uint8Array => {
  if (!(value instanceof Uint8Array)) {
    throw new Error("dictation audio must be a Uint8Array");
  }
  if (value.byteLength === 0 || value.byteLength > dictation_limit_bytes) {
    throw new Error(`dictation audio is ${value.byteLength} bytes, it must be 1 to ${dictation_limit_bytes}`);
  }
  return value;
};

const save_upload = async (value: AttachmentUpload): Promise<Attachment> => {
  const original = await save_attachment(value);
  const saved = original.kind === "image" && value.model_source ? await save_model_copy(value.model_source, original) : original;
  return remember_upload(saved);
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
  handle("attachments:save", (value) => save_upload(upload(value)));
  handle("attachments:discard", (ids) => discard_uploads(parse_ids(ids)));
  handle("attachments:read_text", (id) => read_attachment_text(media_id(id, "attachment id")));
  handle("artifacts:list", (project_path) => list_artifacts(require_string(project_path, "project path", 2000)));
  handle("artifacts:update", (id, patch) => update_artifact(media_id(id, "artifact id"), artifact_patch(patch)));
  handle("artifacts:export", (id) => export_artifact(media_id(id, "artifact id")));
  handle("dictation:transcribe", async (audio) => {
    const recording = dictation_audio(audio);
    return transcribe((await model_catalog()).side.transcription, recording);
  });
};
