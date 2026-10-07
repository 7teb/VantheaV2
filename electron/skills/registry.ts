import path from "node:path";
import { as_record, as_string } from "../storage/coerce.ts";

export type SkillInstall = { source: string; ref: string; commit: string; sha256: string; installed_at: string };

export type SkillRegistry = Record<string, SkillInstall>;

export const parse_install = (value: unknown): SkillInstall => {
  const raw = as_record(value);
  return {
    source: as_string(raw.source),
    ref: as_string(raw.ref),
    commit: as_string(raw.commit),
    sha256: as_string(raw.sha256),
    installed_at: as_string(raw.installed_at) || as_string(raw.installedAt),
  };
};

export const parse_registry = (value: unknown): SkillRegistry =>
  Object.fromEntries(Object.entries(as_record(value)).map(([slug, install]) => [slug, parse_install(install)]));

export const executable_extensions = new Set([
  ".bat", ".cjs", ".cmd", ".com", ".dll", ".exe", ".jar", ".js", ".mjs", ".msi", ".ps1", ".psm1", ".py", ".rb", ".scr", ".sh", ".vbs", ".wsf",
]);

export const executable_names = (names: string[]): string[] => names.filter((name) => executable_extensions.has(path.extname(name).toLowerCase()));

export const plain_file_name = (name: string): boolean => name !== "" && name !== "." && name !== ".." && !/[\\/:]/.test(name) && path.basename(name) === name;
