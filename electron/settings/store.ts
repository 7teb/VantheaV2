import type { ProjectEntry, SecretName, Settings, SettingsPatch, SettingsView } from "../../shared/settings.ts";
import { as_record, as_string } from "../storage/coerce.ts";
import { keep_corrupt, read_json, write_json } from "../storage/json-file.ts";
import { folder_name, path_key } from "../storage/paths.ts";
import type { SecretCodec } from "../storage/secrets.ts";
import { convert_legacy_settings } from "./legacy.ts";
import { default_settings, merge_settings, normalize_settings, project_name } from "./validate.ts";

export type SettingsFiles = { settings: string; secrets: string; legacy_settings: string };

export type SettingsInit = { files: SettingsFiles; codec: SecretCodec; on_change: (view: SettingsView) => void };

type Ciphers = Record<SecretName, string | null>;

export const secret_names: readonly SecretName[] = ["openrouter", "tavily"];

let files: SettingsFiles | null = null;
let codec: SecretCodec | null = null;
let on_change: (view: SettingsView) => void = () => undefined;
let current: Settings = default_settings();
let ciphers: Ciphers = { openrouter: null, tavily: null };
const decrypted = new Map<SecretName, string>();

const settings_files = (): SettingsFiles => {
  if (!files) {
    throw new Error("settings used before init_settings");
  }
  return files;
};

const parse_ciphers = (value: unknown): Ciphers => {
  const raw = as_record(value);
  return { openrouter: as_string(raw.openrouter) || null, tavily: as_string(raw.tavily) || null };
};

const load_ciphers = async (file: string, legacy: Ciphers | null): Promise<Ciphers> => {
  const stored = await read_json(file);
  if (stored.status === "ok") {
    return parse_ciphers(stored.value);
  }
  if (stored.status === "corrupt") {
    console.error(`[settings] ${file} is not valid JSON (${stored.error}), keeping a copy at ${await keep_corrupt(file)}`);
    return { openrouter: null, tavily: null };
  }
  if (!legacy) {
    return { openrouter: null, tavily: null };
  }
  await write_json(file, { version: 1, ...legacy });
  return legacy;
};

const load_legacy = async (file: string) => {
  const legacy = await read_json(file);
  if (legacy.status === "missing") {
    return null;
  }
  if (legacy.status === "corrupt") {
    console.error(`[settings] legacy ${file} is not valid JSON (${legacy.error}), starting from defaults`);
    return null;
  }
  return convert_legacy_settings(legacy.value);
};

export const init_settings = async (options: SettingsInit) => {
  files = options.files;
  codec = options.codec;
  on_change = options.on_change;
  decrypted.clear();
  const stored = await read_json(files.settings);
  if (stored.status === "ok") {
    current = normalize_settings(stored.value, default_settings());
    ciphers = await load_ciphers(files.secrets, null);
    return;
  }
  if (stored.status === "corrupt") {
    console.error(`[settings] ${files.settings} is not valid JSON (${stored.error}), keeping a copy at ${await keep_corrupt(files.settings)}`);
  }
  const legacy = stored.status === "missing" ? await load_legacy(files.legacy_settings) : null;
  current = legacy?.settings ?? default_settings();
  ciphers = await load_ciphers(files.secrets, legacy?.secrets ?? null);
  await write_json(files.settings, current);
};

export const get_settings = (): Settings => current;

export const get_secret = (name: SecretName): string => {
  const cached = decrypted.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const cipher = ciphers[name];
  if (!cipher || !codec) {
    return "";
  }
  try {
    const plain = codec.decrypt(cipher);
    decrypted.set(name, plain);
    return plain;
  } catch (error) {
    console.error(`[settings] decrypting the stored ${name} key failed, treating it as missing:`, error);
    decrypted.set(name, "");
    return "";
  }
};

export const settings_view = (): SettingsView => ({
  ...current,
  secrets: { openrouter: Boolean(get_secret("openrouter")), tavily: Boolean(get_secret("tavily")) },
});

export const update_settings = async (patch: SettingsPatch | Record<string, unknown>): Promise<SettingsView> => {
  const next = merge_settings(current, patch);
  if (JSON.stringify(next) === JSON.stringify(current)) {
    return settings_view();
  }
  current = next;
  const view = settings_view();
  on_change(view);
  await write_json(settings_files().settings, current);
  return view;
};

export const set_secret = async (name: SecretName, value: string): Promise<SettingsView> => {
  if (!codec) {
    throw new Error("settings used before init_settings");
  }
  const plain = value.trim();
  const cipher = plain ? codec.encrypt(plain) : null;
  ciphers = { ...ciphers, [name]: cipher };
  decrypted.set(name, plain);
  await write_json(settings_files().secrets, { version: 1, ...ciphers });
  const view = settings_view();
  on_change(view);
  return view;
};

const same_project = (a: string, b: string) => path_key(a) === path_key(b);

export const find_project = (project_path: string): ProjectEntry | null =>
  current.projects.find((entry) => same_project(entry.path, project_path)) ?? null;

export const add_project = async (project_path: string, folder_id: string): Promise<ProjectEntry> => {
  const entry = { ...(find_project(project_path) ?? { path: project_path, name: project_name("", project_path), pinned: false }), folder_id };
  await update_settings({ projects: [entry, ...current.projects.filter((item) => !same_project(item.path, project_path))] });
  return entry;
};

export const set_project_folder = async (project_path: string, folder: { path: string; folder_id: string }): Promise<SettingsView> => {
  const existing = find_project(project_path);
  if (!existing) {
    throw new Error(`project ${project_path} is not in the project list`);
  }
  const default_name = existing.name === folder_name(existing.path);
  const next: ProjectEntry = { ...existing, ...folder, name: default_name ? folder_name(folder.path) : existing.name };
  return update_settings({ projects: current.projects.map((item) => (item === existing ? next : item)) });
};

export const update_project = async (project_path: string, patch: { name?: string; pinned?: boolean }): Promise<SettingsView> => {
  const existing = find_project(project_path);
  if (!existing) {
    throw new Error(`project ${project_path} is not in the project list`);
  }
  const next: ProjectEntry = {
    ...existing,
    name: patch.name === undefined ? existing.name : project_name(patch.name, existing.path),
    pinned: patch.pinned === undefined ? existing.pinned : patch.pinned,
  };
  return update_settings({ projects: current.projects.map((item) => (item === existing ? next : item)) });
};

export const remove_project = async (project_path: string): Promise<SettingsView> =>
  update_settings({ projects: current.projects.filter((item) => !same_project(item.path, project_path)) });
