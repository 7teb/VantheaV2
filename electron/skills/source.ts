import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { as_number, as_record, as_string, error_code } from "../storage/coerce.ts";
import { max_skill_bytes, parse_skill_file } from "./frontmatter.ts";
import { executable_names, plain_file_name } from "./registry.ts";
import type { PreparedSkill } from "./store.ts";

type GithubEntry = { type: string; name: string; size: number; download_url: string; sha: string };

export type TextFetch = (url: string, accept: string, signal: AbortSignal) => Promise<string>;

const max_extra_files = 20;

const fetch_timeout_ms = 20000;

const extra_pattern = /\.(md|markdown|txt|json|ya?ml)$/i;

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export const fetch_text: TextFetch = async (url, accept, signal) => {
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(fetch_timeout_ms)]),
    headers: { "User-Agent": "VantheaX", Accept: accept },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response.text();
};

const parsed_or_throw = (raw: string) => {
  const parsed = parse_skill_file(raw);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.skill;
};

const reject_executables = (names: string[], where: string) => {
  const executables = executable_names(names);
  if (executables.length) {
    throw new Error(`${where} ships executable files (${executables.join(", ")}). Skills with executable content are not supported, only SKILL.md and plain documents.`);
  }
};

const github_entries = async (url: URL, fetch_fn: TextFetch, signal: AbortSignal) => {
  const [owner, repo, kind, ref = "", ...rest] = url.pathname.split("/").filter(Boolean);
  if (!owner || !repo) {
    throw new Error("This GitHub URL has no owner and repository");
  }
  let dir = kind === "tree" || kind === "blob" ? rest.join("/") : "";
  if (kind === "blob") {
    if (!dir.toLowerCase().endsWith("skill.md")) {
      throw new Error("A GitHub blob URL must point at a SKILL.md");
    }
    dir = dir.split("/").slice(0, -1).join("/");
  }
  const branch = kind === "tree" || kind === "blob" ? ref : "";
  const route = dir.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const query = branch ? `?ref=${encodeURIComponent(branch)}` : "";
  const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${route}${query}`;
  const parsed: unknown = JSON.parse(await fetch_fn(api, "application/vnd.github+json", signal));
  const listing: GithubEntry[] = (Array.isArray(parsed) ? parsed : [parsed]).map((value) => {
    const raw = as_record(value);
    return { type: as_string(raw.type), name: as_string(raw.name), size: as_number(raw.size, 0), download_url: as_string(raw.download_url), sha: as_string(raw.sha) };
  });
  return { dir, branch, files: listing.filter((entry) => entry.type === "file" && entry.name && entry.download_url.startsWith("https://")) };
};

const prepare_github = async (url: URL, fetch_fn: TextFetch, signal: AbortSignal): Promise<PreparedSkill> => {
  const { dir, branch, files } = await github_entries(url, fetch_fn, signal);
  const main = files.find((entry) => entry.name.toLowerCase() === "skill.md");
  if (!main) {
    throw new Error(`No SKILL.md in ${dir || "the repository root"}. Point the URL at the folder that contains SKILL.md.`);
  }
  if (main.size > max_skill_bytes) {
    throw new Error(`SKILL.md is ${main.size} bytes, the limit is ${max_skill_bytes}`);
  }
  reject_executables(files.map((entry) => entry.name), "This skill");
  const raw = await fetch_fn(main.download_url, "text/plain", signal);
  const skill = parsed_or_throw(raw);
  const extras: PreparedSkill["extras"] = [];
  for (const entry of files) {
    if (entry === main || entry.name.startsWith(".") || extras.length >= max_extra_files || !extra_pattern.test(entry.name) || entry.size > max_skill_bytes) {
      continue;
    }
    if (!plain_file_name(entry.name)) {
      throw new Error(`This skill lists a file name that is not a plain file name and cannot be installed safely: ${JSON.stringify(entry.name.slice(0, 120))}`);
    }
    extras.push({ name: entry.name, content: await fetch_fn(entry.download_url, "text/plain", signal) });
  }
  return { name: skill.name, description: skill.description, raw, extras, source: url.href, ref: branch, commit: main.sha, sha256: sha256(raw) };
};

const prepare_url = async (url: URL, fetch_fn: TextFetch, signal: AbortSignal): Promise<PreparedSkill> => {
  if (!/\.(md|markdown)$/i.test(url.pathname)) {
    throw new Error("A direct URL must point at a SKILL.md file");
  }
  const raw = await fetch_fn(url.href, "text/plain", signal);
  const skill = parsed_or_throw(raw);
  return { name: skill.name, description: skill.description, raw, extras: [], source: url.href, ref: "", commit: "", sha256: sha256(raw) };
};

const stat_or_null = async (file: string) => {
  try {
    return await fs.stat(file);
  } catch (error) {
    if (error_code(error) === "ENOENT") {
      return null;
    }
    throw error;
  }
};

export const prepare_path = async (source: string): Promise<PreparedSkill> => {
  if (!path.isAbsolute(source)) {
    throw new Error("A local skill source must be an absolute path to a skill folder or its SKILL.md");
  }
  const stat = await stat_or_null(source);
  if (!stat) {
    throw new Error(`No such path: ${source}`);
  }
  const file = stat.isDirectory() ? path.join(source, "SKILL.md") : source;
  if (path.basename(file).toLowerCase() !== "skill.md") {
    throw new Error("A local path must be a skill folder or its SKILL.md");
  }
  const size = (await stat_or_null(file))?.size;
  if (size === undefined) {
    throw new Error(`No SKILL.md in ${path.dirname(file)}`);
  }
  if (size > max_skill_bytes) {
    throw new Error(`SKILL.md is ${size} bytes, the limit is ${max_skill_bytes}`);
  }
  const raw = await fs.readFile(file, "utf8");
  const skill = parsed_or_throw(raw);
  const dir = path.dirname(file);
  const names = (await fs.readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name);
  reject_executables(names, "This skill folder");
  const extras: PreparedSkill["extras"] = [];
  for (const name of names) {
    if (name.toLowerCase() === "skill.md" || name.startsWith(".") || extras.length >= max_extra_files || !extra_pattern.test(name)) {
      continue;
    }
    if (((await stat_or_null(path.join(dir, name)))?.size ?? 0) > max_skill_bytes) {
      continue;
    }
    extras.push({ name, content: await fs.readFile(path.join(dir, name), "utf8") });
  }
  return { name: skill.name, description: skill.description, raw, extras, source: dir, ref: "", commit: "", sha256: sha256(raw) };
};

export const prepare_skill = async (source: string, signal: AbortSignal, fetch_fn: TextFetch = fetch_text): Promise<PreparedSkill> => {
  const value = source.trim();
  if (!value) {
    throw new Error("No skill source given");
  }
  const url = URL.canParse(value) ? new URL(value) : null;
  if (url && (url.protocol === "http:" || url.protocol === "https:")) {
    return url.hostname === "github.com" ? prepare_github(url, fetch_fn, signal) : prepare_url(url, fetch_fn, signal);
  }
  return prepare_path(value);
};
