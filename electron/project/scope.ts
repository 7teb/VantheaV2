import fs from "node:fs/promises";
import path from "node:path";
import { error_code, error_text } from "../storage/coerce.ts";

export type ScopedPath = { root: string; target: string; relative: string };

export type WriteTarget = ScopedPath & { exists: boolean };

const secret_names = [
  /^\.env($|\.)/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^id_rsa$/i,
  /^id_ed25519$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^secrets\./i,
  /^credentials\./i,
];

const secret_exceptions = new Set([".env.example", ".env.sample"]);

const reserved_device = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

export const outside_message =
  "Path is outside the project folder. list_files, read_file and grep_files only reach the project; read a file outside it with run_command, for example Get-Content -Raw '<absolute path>'.";

export const to_posix = (value: string) => value.replaceAll("\\", "/");

const windows_name = (part: string) => part.replace(/[. ]+$/, "");

export const is_secret_path = (relative: string): boolean => {
  const normalized = to_posix(relative).toLowerCase();
  if (normalized === ".git/config" || normalized.endsWith("/.git/config")) {
    return true;
  }
  return normalized.split("/").some((raw) => {
    const part = windows_name(raw);
    if (part === ".ssh") {
      return true;
    }
    return !secret_exceptions.has(part) && secret_names.some((pattern) => pattern.test(part));
  });
};

export const is_inside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

export const project_real_root = async (project_root: string): Promise<string> => {
  if (!project_root.trim()) {
    throw new Error("No project folder is open for this chat.");
  }
  let real: string;
  try {
    real = await fs.realpath(path.resolve(project_root));
  } catch (error) {
    throw new Error(`Project folder ${project_root} is not accessible: ${error_text(error)}`, { cause: error });
  }
  if (!(await fs.stat(real)).isDirectory()) {
    throw new Error(`Project path ${project_root} is not a directory`);
  }
  return real;
};

export const resolve_inside = async (project_root: string, relative = "."): Promise<ScopedPath> => {
  const root = await project_real_root(project_root);
  const requested = path.resolve(root, relative || ".");
  if (!is_inside(root, requested)) {
    throw new Error(outside_message);
  }
  let target: string;
  try {
    target = await fs.realpath(requested);
  } catch (error) {
    if (error_code(error) === "ENOENT") {
      throw new Error(`${to_posix(relative)} does not exist in the project`, { cause: error });
    }
    throw error;
  }
  if (!is_inside(root, target)) {
    throw new Error(outside_message);
  }
  return { root, target, relative: to_posix(path.relative(root, target)) || "." };
};

const check_write_path = (relative: string) => {
  if (!relative || relative.includes("\0")) {
    throw new Error("path must be a non-empty project-relative file path");
  }
  if (relative.includes(":") || /^[\\/]{2}/.test(relative) || path.isAbsolute(relative)) {
    throw new Error(`${relative} is not a project-relative path: drive letters, UNC paths, absolute paths and ':' streams are not allowed`);
  }
  if (to_posix(relative).split("/").some((part) => reserved_device.test(windows_name(part)))) {
    throw new Error(`${relative} uses a reserved Windows device name`);
  }
};

const nearest_existing = async (dir: string): Promise<string> => {
  let current = dir;
  for (;;) {
    try {
      await fs.lstat(current);
      return current;
    } catch (error) {
      const parent = path.dirname(current);
      if (error_code(error) !== "ENOENT" || parent === current) {
        throw error;
      }
      current = parent;
    }
  }
};

const lstat_or_null = async (target: string) => {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error_code(error) === "ENOENT") {
      return null;
    }
    throw error;
  }
};

export const resolve_write_target = async (project_root: string, relative: string): Promise<WriteTarget> => {
  check_write_path(relative);
  const root = await project_real_root(project_root);
  const parent = path.resolve(root, path.dirname(relative));
  if (!is_inside(root, parent)) {
    throw new Error("Path is outside the project folder");
  }
  const existing = await nearest_existing(parent);
  const real_existing = await fs.realpath(existing);
  if (!is_inside(root, real_existing)) {
    throw new Error("Path is outside the project folder (a parent folder links out of the project)");
  }
  const target = path.join(real_existing, path.relative(existing, parent), path.basename(relative));
  if (!is_inside(root, target)) {
    throw new Error("Path is outside the project folder");
  }
  const info = await lstat_or_null(target);
  if (info?.isSymbolicLink()) {
    throw new Error(`Refusing to write through a symlink: ${relative}`);
  }
  if (info?.isDirectory()) {
    throw new Error(`${relative} is a directory`);
  }
  const final = info ? await fs.realpath(target) : target;
  const final_relative = to_posix(path.relative(root, final));
  if (is_secret_path(final_relative)) {
    throw new Error(`Refusing to write to a secret file path: ${final_relative}`);
  }
  return { root, target: final, relative: final_relative, exists: Boolean(info) };
};
