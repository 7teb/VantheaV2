import fs from "node:fs/promises";
import path from "node:path";
import { error_code } from "../storage/coerce.ts";
import { read_json } from "../storage/json-file.ts";
import { executable_names, parse_registry, type SkillRegistry } from "./registry.ts";

const exists = async (file: string): Promise<boolean> => {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error_code(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
};

const legacy_folders = async (legacy_root: string): Promise<string[]> => {
  try {
    const listing = await fs.readdir(legacy_root, { withFileTypes: true });
    return listing.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name);
  } catch (error) {
    if (error_code(error) === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const legacy_registry = async (legacy_root: string): Promise<SkillRegistry> => {
  const file = path.join(legacy_root, "installed.json");
  const stored = await read_json(file);
  if (stored.status === "corrupt") {
    console.error(`[skills] legacy ${file} is not valid JSON (${stored.error}), skill sources are not imported`);
  }
  return stored.status === "ok" ? parse_registry(stored.value) : {};
};

const import_folder = async (source: string, target: string): Promise<boolean> => {
  if (!(await exists(path.join(source, "SKILL.md"))) || (await exists(target))) {
    return false;
  }
  const names = (await fs.readdir(source, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name);
  const executables = executable_names(names);
  if (executables.length) {
    console.warn(`[skills] legacy skill ${source} ships executable files (${executables.join(", ")}) and was not imported`);
    return false;
  }
  await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false });
  return true;
};

export const import_legacy_skills = async (legacy_root: string, root: string): Promise<SkillRegistry> => {
  const installs = await legacy_registry(legacy_root);
  const imported: SkillRegistry = {};
  for (const slug of await legacy_folders(legacy_root)) {
    if (await import_folder(path.join(legacy_root, slug), path.join(root, slug))) {
      imported[slug] = installs[slug] ?? { source: "", ref: "", commit: "", sha256: "", installed_at: "" };
    }
  }
  if (Object.keys(imported).length) {
    console.info(`[skills] imported ${Object.keys(imported).length} skills from ${legacy_root}`);
  }
  return imported;
};
