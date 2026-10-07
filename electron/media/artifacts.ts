import { attachment_limits, type Artifact } from "../../shared/ipc/media.ts";
import { as_array, as_boolean, as_iso, as_record, as_string } from "../storage/coerce.ts";
import { keep_corrupt, read_json, write_json } from "../storage/json-file.ts";
import { path_key } from "../storage/paths.ts";
import { is_media_id, new_media_id, sniff_image, write_media } from "./files.ts";
import { import_legacy_media } from "./legacy.ts";

export type ArtifactsInit = {
  file: string;
  legacy_file: string;
  legacy_root: string;
  on_change: (project_path: string) => void;
};

export type GeneratedImageMeta = { prompt: string; chat_id: string; project_path: string };

let file: string | null = null;
let on_change: (project_path: string) => void = () => undefined;
let artifacts: Artifact[] = [];

const artifacts_file = (): string => {
  if (!file) {
    throw new Error("artifacts used before init_artifacts");
  }
  return file;
};

const parse_artifact = (value: unknown, fallback_time: string): Artifact | null => {
  const raw = as_record(value);
  if (!is_media_id(raw.id) || raw.kind !== "image") {
    return null;
  }
  return {
    id: raw.id,
    kind: "image",
    title: as_string(raw.title).slice(0, 120),
    prompt: as_string(raw.prompt).slice(0, 300),
    project_path: as_string(raw.project_path),
    chat_id: as_string(raw.chat_id),
    pinned: as_boolean(raw.pinned, false),
    created_at: as_iso(raw.created_at, fallback_time),
  };
};

const convert_legacy_artifacts = (value: unknown, fallback_time: string): Artifact[] =>
  as_array(value).flatMap((entry) => {
    const raw = as_record(entry);
    if (raw.kind === "video") {
      return [];
    }
    const artifact = parse_artifact(
      {
        id: raw.name,
        kind: "image",
        title: raw.title,
        prompt: raw.prompt,
        project_path: raw.projectPath,
        chat_id: raw.chatId,
        pinned: raw.pinned,
        created_at: raw.createdAt,
      },
      fallback_time,
    );
    return artifact ? [artifact] : [];
  });

const persist = () => write_json(artifacts_file(), { version: 1, artifacts });

const import_legacy = async (options: ArtifactsInit): Promise<Artifact[]> => {
  const legacy = await read_json(options.legacy_file);
  if (legacy.status === "missing") {
    return [];
  }
  if (legacy.status === "corrupt") {
    console.error(`[artifacts] legacy ${options.legacy_file} is not valid JSON (${legacy.error}), no artifacts imported`);
    return [];
  }
  const imported = convert_legacy_artifacts(legacy.value, new Date().toISOString());
  for (const artifact of imported) {
    await import_legacy_media(options.legacy_root, { bucket: "image", name: artifact.id });
  }
  return imported;
};

export const init_artifacts = async (options: ArtifactsInit) => {
  file = options.file;
  on_change = options.on_change;
  const stored = await read_json(options.file);
  if (stored.status === "ok") {
    const now = new Date().toISOString();
    artifacts = as_array(as_record(stored.value).artifacts).flatMap((entry) => parse_artifact(entry, now) ?? []);
    return;
  }
  if (stored.status === "corrupt") {
    console.error(`[artifacts] ${options.file} is not valid JSON (${stored.error}), keeping a copy at ${await keep_corrupt(options.file)}`);
  }
  artifacts = stored.status === "missing" ? await import_legacy(options) : [];
  await persist();
};

export const list_artifacts = (project_path: string): Artifact[] => {
  const key = path_key(project_path);
  return artifacts.filter((entry) => path_key(entry.project_path) === key);
};

export const move_project_artifacts = async (old_path: string, next_path: string): Promise<void> => {
  const key = path_key(old_path);
  if (!artifacts.some((entry) => path_key(entry.project_path) === key)) {
    return;
  }
  artifacts = artifacts.map((entry) => (path_key(entry.project_path) === key ? { ...entry, project_path: next_path } : entry));
  await persist();
  on_change(next_path);
};

export const find_artifact = (artifact_id: string): Artifact | null => artifacts.find((entry) => entry.id === artifact_id) ?? null;

export const update_artifact = async (artifact_id: string, patch: { title?: string; pinned?: boolean }): Promise<Artifact> => {
  const existing = find_artifact(artifact_id);
  if (!existing) {
    throw new Error(`artifact ${artifact_id} not found`);
  }
  const next: Artifact = {
    ...existing,
    title: patch.title === undefined ? existing.title : patch.title.trim().slice(0, 120),
    pinned: patch.pinned === undefined ? existing.pinned : patch.pinned,
  };
  artifacts = artifacts.map((entry) => (entry === existing ? next : entry));
  await persist();
  on_change(next.project_path);
  return next;
};

export const save_generated_image = async (bytes: Uint8Array, mime: string, meta: GeneratedImageMeta): Promise<{ id: string }> => {
  const kind = sniff_image(bytes);
  if (!kind) {
    throw new Error(`generated image (declared ${mime}) is not a recognized PNG, JPEG, GIF, WebP or BMP`);
  }
  if (bytes.length > attachment_limits.image_bytes) {
    throw new Error("generated image exceeds the 20 MB limit");
  }
  const id = new_media_id("img", kind.ext);
  await write_media("image", id, bytes);
  artifacts = [
    ...artifacts,
    {
      id,
      kind: "image",
      title: "",
      prompt: meta.prompt.slice(0, 300),
      project_path: meta.project_path,
      chat_id: meta.chat_id,
      pinned: false,
      created_at: new Date().toISOString(),
    },
  ];
  await persist();
  on_change(meta.project_path);
  return { id };
};
