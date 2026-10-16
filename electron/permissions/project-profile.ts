import fs from "node:fs/promises";
import path from "node:path";
import { strip_userinfo } from "../../shared/git/remote-url.ts";
import { git_location, type GitLocation } from "../git/repo.ts";
import { list_top_level } from "../prompts/project.ts";
import { error_code, missing_path } from "../storage/coerce.ts";

export type ProjectProfile = { root: string; git: string; listing: string; readme: string | null; scripts: string | null };

const read_optional = async (file: string): Promise<string | null> => {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (!missing_path(error)) {
      console.warn(`[permissions] reading ${file} for the project profile failed: ${error_code(error) || String(error)}`);
    }
    return null;
  }
};

type GitConfig = { branches: Map<string, { remote: string; merge: string }>; remotes: Map<string, string>; includes: boolean };

const parse_config = (text: string): GitConfig => {
  const config: GitConfig = { branches: new Map(), remotes: new Map(), includes: false };
  let section = "";
  let name = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[\s*([\w.-]+)(?:\s+"([^"]*)")?\s*\]$/.exec(line);
    if (header) {
      section = (header[1] ?? "").toLowerCase();
      name = header[2] ?? "";
      if (section === "include" || section === "includeif") config.includes = true;
      continue;
    }
    const pair = /^([\w-]+)\s*=\s*(.*)$/.exec(line);
    if (!pair) continue;
    const key = (pair[1] ?? "").toLowerCase();
    const value = (pair[2] ?? "").trim().replace(/^"(.*)"$/, "$1");
    if (section === "branch" && name && (key === "remote" || key === "merge")) {
      const branch = config.branches.get(name) ?? { remote: "", merge: "" };
      branch[key] = value;
      config.branches.set(name, branch);
    }
    if (section === "remote" && name && key === "url") config.remotes.set(name, strip_userinfo(value));
  }
  return config;
};

export const git_line = async (root: string, location: GitLocation | null): Promise<string> => {
  if (!location) {
    return "git: not a git repository";
  }
  const head = ((await read_optional(path.join(location.git_dir, "HEAD"))) ?? "").trim();
  const branch = /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1] ?? "";
  const config = parse_config((await read_optional(path.join(location.common_dir, "config"))) ?? "");
  const where = path.resolve(location.work_tree) === path.resolve(root) ? "repository at root" : `repository at ${location.work_tree}`;
  const parts = [where, branch ? `branch ${branch}` : head ? `detached at ${head.slice(0, 12)}` : "HEAD unreadable"];
  const tracking = branch ? config.branches.get(branch) : undefined;
  if (tracking?.remote && tracking.merge) parts.push(`upstream ${tracking.remote}/${tracking.merge.replace(/^refs\/heads\//, "")}`);
  for (const [remote, url] of config.remotes) parts.push(`remote ${remote} ${url}`);
  if (config.includes) parts.push("config includes not read");
  return `git: ${parts.join(", ")}`;
};

const package_scripts = (text: string | null): string | null => {
  if (!text) {
    return null;
  }
  try {
    const scripts = (JSON.parse(text.replace(/^﻿/, "")) as { scripts?: unknown }).scripts;
    if (!scripts || typeof scripts !== "object") {
      return null;
    }
    return JSON.stringify(scripts);
  } catch (error) {
    console.warn(`[permissions] package.json scripts are not readable JSON: ${String(error)}`);
    return null;
  }
};

export const read_profile = async (root: string): Promise<ProjectProfile> => {
  if (!root.trim()) {
    return { root: "", git: "git: no project folder", listing: "", readme: null, scripts: null };
  }
  const [location, listing, readme, manifest] = await Promise.all([
    git_location(root),
    list_top_level(root),
    read_optional(path.join(root, "README.md")),
    read_optional(path.join(root, "package.json")),
  ]);
  return {
    root,
    git: await git_line(root, location),
    listing,
    readme: readme === null ? null : readme.replace(/^﻿/, "").trimEnd(),
    scripts: package_scripts(manifest),
  };
};
