import fs from "node:fs/promises";
import path from "node:path";
import { parse_frontmatter } from "../skills/frontmatter.ts";
import { error_code, error_text } from "../storage/coerce.ts";
import { read_role, role_name_ok, ScriptError, type RoleSpec } from "./meta.ts";

export type RoleEntry = { spec: RoleSpec; source: string } | { error: string; source: string };

export type RoleBook = { script: Record<string, RoleSpec>; project: Map<string, RoleEntry>; user: Map<string, RoleEntry> };

export type ResolvedRole = { name: string; spec: RoleSpec };

const builtin: Record<"explore" | "worker", RoleSpec> = {
  explore: { profile: "explore", instructions: "", model: "", effort: "", description: "read-only, its file tools stay inside the project" },
  worker: { profile: "worker", instructions: "", model: "", effort: "", description: "reads, edits files and runs commands" },
};

export const project_roles_dir = (project_root: string) => path.join(project_root, ".vantheax", "roles");

export const parse_role_file = (raw: string, stem: string): RoleSpec => {
  const lines = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trimEnd() !== "---") {
    throw new ScriptError("a role file must start with a frontmatter block delimited by ---");
  }
  const close = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---");
  if (close < 0) {
    throw new ScriptError("the frontmatter of the role file is never closed with ---");
  }
  const head = parse_frontmatter(lines.slice(1, close).join("\n"));
  if (head.name && head.name !== stem) {
    throw new ScriptError(`the role file ${stem}.md names itself ${head.name}; the name must match the file name`);
  }
  return read_role(
    {
      profile: head.profile || "explore",
      instructions: lines.slice(close + 1).join("\n").trim(),
      ...(head.model ? { model: head.model } : {}),
      ...(head.effort ? { effort: head.effort } : {}),
      ...(head.description ? { description: head.description } : {}),
    },
    `role file ${stem}.md`,
  );
};

const load_dir = async (dir: string): Promise<Map<string, RoleEntry>> => {
  const roles = new Map<string, RoleEntry>();
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if (error_code(error) === "ENOENT" || error_code(error) === "ENOTDIR") {
      return roles;
    }
    console.error(`[workflows] listing the role folder ${dir} failed: ${error_text(error)}`);
    return roles;
  }
  for (const name of names.filter((entry) => entry.toLowerCase().endsWith(".md"))) {
    const stem = name.slice(0, -3);
    const file = path.join(dir, name);
    if (!role_name_ok(stem)) {
      continue;
    }
    try {
      roles.set(stem.toLowerCase(), { spec: parse_role_file(await fs.readFile(file, "utf8"), stem), source: file });
    } catch (error) {
      console.warn(`[workflows] the role file ${file} cannot be used: ${error_text(error)}`);
      roles.set(stem.toLowerCase(), { error: error_text(error), source: file });
    }
  }
  return roles;
};

export const load_roles = async (script: Record<string, RoleSpec>, project_root: string, user_dir: string): Promise<RoleBook> => {
  const [project, user] = await Promise.all([load_dir(project_roles_dir(project_root)), load_dir(user_dir)]);
  return { script, project, user };
};

const from_entry = (name: string, entry: RoleEntry | undefined): ResolvedRole | null => {
  if (!entry) {
    return null;
  }
  if ("error" in entry) {
    throw new ScriptError(`the role ${name} from ${entry.source} cannot be used: ${entry.error}`);
  }
  return { name, spec: entry.spec };
};

export const known_roles = (book: RoleBook): string[] => [...new Set([...Object.keys(book.script), ...book.project.keys(), ...book.user.keys(), "explore", "worker"])];

export const resolve_role = (book: RoleBook, value: unknown): ResolvedRole => {
  if (value === undefined) {
    return { name: "worker", spec: builtin.worker };
  }
  if (typeof value === "object" && value !== null) {
    return { name: "inline", spec: read_role(value, "opts.role") };
  }
  const name = String(value).trim();
  if (name === "explore" || name === "worker") {
    return { name, spec: builtin[name] };
  }
  const script = Object.hasOwn(book.script, name) ? book.script[name] : undefined;
  if (script) {
    return { name, spec: script };
  }
  const found = from_entry(name, book.project.get(name.toLowerCase())) ?? from_entry(name, book.user.get(name.toLowerCase()));
  if (found) {
    return found;
  }
  throw new ScriptError(`Unknown role ${name}. Known roles: ${known_roles(book).join(", ")}. Define roles in meta.roles, in .vantheax/roles/<name>.md of the project or in the user role folder.`);
};
