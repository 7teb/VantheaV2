import fs from "node:fs/promises";
import path from "node:path";
import { error_code, error_text } from "../storage/coerce.ts";
import { max_skill_bytes, parse_skill_file } from "./frontmatter.ts";

export type SkillRecord = {
  slug: string;
  name: string;
  description: string;
  body: string;
  files: string[];
  error: string;
  dir: string;
  group: string;
  builtin: boolean;
};

export type SkillRoots = { builtin: string; user: string };

type Folder = { slug: string; dir: string; group: string; builtin: boolean };

export const builtin_prefix = "builtin:";

const max_skills = 200;

const broken = (folder: Folder, error: string): SkillRecord => ({ ...folder, name: folder.slug, description: "", body: "", files: [], error });

const subfolders = async (dir: string): Promise<string[]> =>
  (await fs.readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

const group_children = async (dir: string): Promise<string[] | null> => {
  try {
    await fs.stat(path.join(dir, "SKILL.md"));
    return null;
  } catch (error) {
    if (error_code(error) !== "ENOENT") {
      console.warn(`[skills] checking ${dir} for a SKILL.md failed, scanning it as a skill folder: ${error_text(error)}`);
      return null;
    }
  }
  const children = await subfolders(dir);
  return children.length ? children : null;
};

const list_folders = async (root: string, builtin: boolean): Promise<Folder[]> => {
  const prefix = builtin ? builtin_prefix : "";
  const skills: Folder[] = [];
  const grouped: Folder[] = [];
  for (const name of await subfolders(root)) {
    const dir = path.join(root, name);
    const children = await group_children(dir);
    if (!children) {
      skills.push({ slug: `${prefix}${name}`, dir, group: "", builtin });
      continue;
    }
    for (const child of children) {
      grouped.push({ slug: `${prefix}${name}/${child}`, dir: path.join(dir, child), group: name, builtin });
    }
  }
  return [...skills, ...grouped];
};

const root_folders = async (root: string, builtin: boolean): Promise<Folder[]> => {
  try {
    return await list_folders(root, builtin);
  } catch (error) {
    if (builtin && error_code(error) === "ENOENT") {
      console.warn(`[skills] the built-in skills folder ${root} does not exist, no built-in skills are loaded`);
      return [];
    }
    throw error;
  }
};

const nested_text_extensions = new Set([".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".css", ".html", ".js", ".mjs", ".py"]);

const max_listed_files = 100;

const nested_files = async (dir: string, sub: string): Promise<string[]> => {
  try {
    const children = await fs.readdir(path.join(dir, sub), { withFileTypes: true });
    return children
      .filter((child) => child.isFile() && !child.name.startsWith(".") && nested_text_extensions.has(path.extname(child.name).toLowerCase()))
      .map((child) => `${sub}/${child.name}`);
  } catch (error) {
    console.warn(`[skills] listing ${path.join(dir, sub)} failed, its files are not listed: ${error_text(error)}`);
    return [];
  }
};

const skill_files = async (dir: string): Promise<string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const flat = entries.filter((entry) => entry.isFile() && !entry.name.startsWith(".") && entry.name.toLowerCase() !== "skill.md").map((entry) => entry.name);
  const nested: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    nested.push(...(await nested_files(dir, entry.name)));
  }
  const by_name = (a: string, b: string) => a.localeCompare(b);
  return [...flat.sort(by_name), ...nested.sort(by_name)].slice(0, max_listed_files);
};

const scan_folder = async (folder: Folder): Promise<SkillRecord> => {
  const file = path.join(folder.dir, "SKILL.md");
  let raw: string;
  try {
    const stat = await fs.stat(file);
    if (stat.size > max_skill_bytes) {
      return broken(folder, `SKILL.md is ${stat.size} bytes, the limit is ${max_skill_bytes}`);
    }
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error_code(error) === "ENOENT") {
      return broken(folder, "no SKILL.md in this folder");
    }
    console.error(`[skills] reading ${file} failed:`, error);
    return broken(folder, `SKILL.md could not be read: ${error_text(error)}`);
  }
  const parsed = parse_skill_file(raw);
  if (!parsed.ok) {
    return broken(folder, parsed.error);
  }
  return { ...folder, ...parsed.skill, files: await skill_files(folder.dir), error: "" };
};

const display_order = (a: SkillRecord, b: SkillRecord): number =>
  Number(b.builtin) - Number(a.builtin) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name);

export const scan_skills = async (roots: SkillRoots): Promise<SkillRecord[]> => {
  const folders = [...(await root_folders(roots.builtin, true)), ...(await root_folders(roots.user, false))].slice(0, max_skills);
  const scanned = await Promise.all(folders.map(scan_folder));
  const owners = new Map<string, string>();
  const checked = scanned.map((record) => {
    if (record.error) {
      return record;
    }
    const owner = owners.get(record.name.toLowerCase());
    if (owner) {
      return broken(record, `duplicate skill name, already used by ${owner}`);
    }
    owners.set(record.name.toLowerCase(), record.slug);
    return record;
  });
  return checked.sort(display_order);
};
