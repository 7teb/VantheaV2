import fs from "node:fs/promises";
import path from "node:path";
import { error_code, error_text } from "../storage/coerce.ts";
import { read_script, ScriptError, type ReadScript } from "./meta.ts";

export type ScriptSource = { text: string; path: string | null; read: ReadScript };

export type SavedWorkflow = { name: string; description: string; when_to_use: string; path: string; scope: "project" | "user" };

export const project_saved_dir = (project_root: string) => path.join(project_root, ".vantheax", "workflows");

const source_of = (text: string, file: string | null): ScriptSource => {
  try {
    return { text, path: file, read: read_script(text) };
  } catch (error) {
    if (error instanceof ScriptError && file) {
      throw new ScriptError(`${file}: ${error.message}`);
    }
    throw error;
  }
};

export const inline_source = (text: string): ScriptSource => source_of(text, null);

export const path_source = async (project_root: string, file: string): Promise<ScriptSource> => {
  const full = path.isAbsolute(file) ? path.normalize(file) : path.resolve(project_root, file);
  let text: string;
  try {
    text = await fs.readFile(full, "utf8");
  } catch (error) {
    throw new ScriptError(`Cannot read the workflow script ${full}: ${error_text(error)}`);
  }
  return source_of(text, full);
};

const scan = async (dir: string, scope: SavedWorkflow["scope"]): Promise<SavedWorkflow[]> => {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if (error_code(error) !== "ENOENT" && error_code(error) !== "ENOTDIR") {
      console.error(`[workflows] listing the saved workflows in ${dir} failed: ${error_text(error)}`);
    }
    return [];
  }
  const found: SavedWorkflow[] = [];
  for (const name of names.filter((entry) => entry.toLowerCase().endsWith(".js")).sort()) {
    const file = path.join(dir, name);
    try {
      const { meta } = read_script(await fs.readFile(file, "utf8"));
      found.push({ name: name.slice(0, -3), description: meta.description, when_to_use: meta.when_to_use, path: file, scope });
    } catch (error) {
      console.warn(`[workflows] the saved workflow ${file} cannot be read: ${error_text(error)}`);
    }
  }
  return found;
};

export const list_saved = async (project_root: string, user_dir: string): Promise<SavedWorkflow[]> => {
  const [project, user] = await Promise.all([scan(project_saved_dir(project_root), "project"), scan(user_dir, "user")]);
  const names = new Set(project.map((entry) => entry.name.toLowerCase()));
  return [...project, ...user.filter((entry) => !names.has(entry.name.toLowerCase()))];
};

export const saved_source = async (project_root: string, user_dir: string, name: string): Promise<ScriptSource> => {
  const wanted = name.trim().replace(/\.js$/i, "").toLowerCase();
  const saved = await list_saved(project_root, user_dir);
  const match = saved.find((entry) => entry.name.toLowerCase() === wanted);
  if (!match) {
    const known = saved.length ? `Saved workflows: ${saved.map((entry) => entry.name).join(", ")}.` : "No saved workflows exist.";
    throw new ScriptError(`No saved workflow ${name}. ${known} Saved workflows are .js files in ${project_saved_dir(project_root)} and ${user_dir}.`);
  }
  return source_of(await fs.readFile(match.path, "utf8"), match.path);
};
