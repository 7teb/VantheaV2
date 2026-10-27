import fs from "node:fs/promises";
import path from "node:path";
import { git_tool } from "../git/locate.ts";
import { exec_git, git_ok } from "../git/run.ts";

const reserved_names = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export const folder_name = (name: string): string => {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  if (!cleaned) {
    return "Project";
  }
  return reserved_names.test(cleaned) ? `${cleaned} project` : cleaned;
};

export const free_folder = async (parent: string, name: string, taken: (target: string) => Promise<boolean>): Promise<string> => {
  for (let index = 1; ; index += 1) {
    const target = path.join(parent, index === 1 ? name : `${name} ${index}`);
    if (!(await taken(target))) {
      return target;
    }
  }
};

const exists = async (target: string): Promise<boolean> => {
  try {
    await fs.stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
};

const init_repository = async (folder: string) => {
  try {
    const found = await git_tool();
    if (found.kind !== "found") {
      return;
    }
    git_ok(await exec_git(found.tool, { cwd: folder, args: ["init"] }), "git init");
  } catch (error) {
    console.warn(`[projects] git init in the new project folder ${folder} failed`, error);
  }
};

export const create_project_folder = async (parent: string, name: string): Promise<string> => {
  const target = await free_folder(parent, folder_name(name), exists);
  await fs.mkdir(target, { recursive: true });
  await init_repository(target);
  return target;
};
