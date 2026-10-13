import type { Attachment } from "../chat.ts";
import { emit, invoke } from "./channel.ts";

export type Artifact = {
  id: string;
  kind: "image";
  title: string;
  prompt: string;
  project_path: string;
  chat_id: string;
  pinned: boolean;
  created_at: string;
};

export type AttachmentUpload = { name: string; mime: string; bytes: Uint8Array; model_source?: Uint8Array; source_path?: string };

export const attachment_limits = { image_bytes: 20 * 1024 * 1024, file_bytes: 20 * 1024 * 1024, max_files: 10 } as const;

export const media_channels = {
  "attachments:save": invoke<[upload: AttachmentUpload], Attachment>(),
  "attachments:discard": invoke<[attachment_ids: string[]], void>(),
  "attachments:read_text": invoke<[attachment_id: string], string>(),
  "artifacts:list": invoke<[project_path: string], Artifact[]>(),
  "artifacts:update": invoke<[artifact_id: string, patch: Partial<Pick<Artifact, "title" | "pinned">>], Artifact>(),
  "artifacts:export": invoke<[artifact_id: string], boolean>(),
  "artifacts:changed": emit<{ project_path: string }>(),
} as const;
