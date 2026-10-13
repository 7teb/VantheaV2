import { readdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { error_code, error_text, missing_path } from "../storage/coerce.ts";
import { read_head } from "../storage/text-codec.ts";
import { read_env, resolved, type Matcher, type Value, type WalkState } from "./command-walk.ts";
import { expand_entry, glob_pattern } from "./script-loads.ts";
import type { ChangeMark } from "./written-files.ts";

export type ProgramKind = "native" | "missing" | "network" | "script" | "installed" | "not_found" | "command" | "powershell_command" | "builtin" | "unresolved_folder" | "unreadable";

export type ProgramFact = { written: string; how: string; path: string; kind: ProgramKind; bytes: number | null; outside: boolean; change: ChangeMark | null; origin: string; line: number };

export type LaunchKind = { kind: "missing" } | { kind: "directory" } | { kind: "unreadable"; failure: string } | { kind: "native" | "file"; bytes: number; mtime: number };

export type PathMatch = { dir: string; file: string; installed: boolean };

export type PathLookup = (names: string[], dirs: string[]) => Promise<PathMatch[]>;

export type PatternMatches = { files: string[]; gaps: string[]; reason: string };

const max_path_dirs = 64;

const max_pattern_files = 8;

const default_pathext = ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC";

const any_file = /[^\\/]$/;

const listings = new Map<string, { mtime: number; names: Map<string, string> }>();

export const native_extension = /\.(?:exe|com)$/i;

export const launch_gap = (written: string, reason: string): string => `Launch target could not be resolved: ${written} (${reason})`;

export const network_path = (file: string): boolean => /^(?:\\\\|\/\/)/.test(file);

export const wildcard_path = (file: string): boolean => /[*?[]/.test(file);

const failure = (error: unknown): string => error_code(error) || error_text(error);

export const env_value = (state: WalkState, name: string): Value =>
  state.values.env.has(name) || state.values.env_reason ? read_env(state.values, name, true) : resolved([state.values.base_env.get(name) ?? ""]);

export const launch_kind = async (file: string): Promise<LaunchKind> => {
  let info;
  try {
    info = await fs.stat(file);
  } catch (error) {
    return missing_path(error) ? { kind: "missing" } : { kind: "unreadable", failure: failure(error) };
  }
  if (info.isDirectory()) return { kind: "directory" };
  if (!native_extension.test(file)) return { kind: "file", bytes: info.size, mtime: info.mtimeMs };
  try {
    const head = await read_head(file);
    return { kind: head[0] === 0x4d && head[1] === 0x5a ? "native" : "file", bytes: info.size, mtime: info.mtimeMs };
  } catch (error) {
    return { kind: "unreadable", failure: failure(error) };
  }
};

export const launch_extensions = (pathext: string, powershell: boolean): string[] => {
  const listed = (pathext || default_pathext).split(";").map((entry) => entry.trim().toLowerCase()).filter((entry) => /^\.\w+$/.test(entry));
  return [...new Set([...(powershell ? [".ps1"] : []), ...listed])];
};

export const path_dirs = (value: string): string[] => {
  const dirs = new Map<string, string>();
  for (const raw of value.split(";")) {
    const dir = raw.trim().replace(/^"(.*)"$/, "$1");
    if (!dir || network_path(dir) || !path.win32.isAbsolute(dir)) continue;
    if (!dirs.has(dir.toLowerCase())) dirs.set(dir.toLowerCase(), dir);
  }
  return [...dirs.values()].slice(0, max_path_dirs);
};

const listing = async (dir: string): Promise<Map<string, string> | null> => {
  try {
    const info = await fs.stat(dir);
    const known = listings.get(dir.toLowerCase());
    if (known && known.mtime === info.mtimeMs) return known.names;
    const names = new Map((await fs.readdir(dir)).map((name) => [name.toLowerCase(), name] as const));
    listings.set(dir.toLowerCase(), { mtime: info.mtimeMs, names });
    return names;
  } catch (error) {
    if (!missing_path(error)) console.warn(`[permissions] listing the PATH directory ${dir} failed: ${failure(error)}`);
    return null;
  }
};

export const path_lookup = (): PathLookup => {
  const checked = new Map<string, Promise<Map<string, string> | null>>();
  return async (names, dirs) => {
    const matches: PathMatch[] = [];
    for (const dir of dirs) {
      const key = dir.toLowerCase();
      const pending = checked.get(key) ?? listing(dir);
      checked.set(key, pending);
      const listed = await pending;
      for (const name of names) {
        const actual = listed?.get(name.toLowerCase());
        if (actual) matches.push({ dir, file: path.win32.join(dir, actual), installed: /[\\/]node_modules[\\/]\.bin[\\/]*$/i.test(dir) });
      }
    }
    return matches;
  };
};

export const expand_launch_pattern = async (pattern: string): Promise<PatternMatches> => {
  const parts = pattern.split(/[\\/]/);
  const first = parts.findIndex(wildcard_path);
  const base = parts.slice(0, first).join("\\");
  const found = await expand_entry(parts.slice(first).join("/"), /^[A-Za-z]:$/.test(base) ? base + "\\" : base, any_file);
  const files = found?.files ?? [];
  const reason = !files.length ? "wildcard matches no file" : files.length > max_pattern_files ? "wildcard matches more than 8 files" : "";
  return { files: reason ? [] : files, gaps: found?.gaps ?? [], reason };
};

export const location_matches: Matcher = (pattern) => {
  const dir = path.win32.dirname(pattern);
  if (wildcard_path(dir)) return [];
  const leaf = glob_pattern(path.win32.basename(pattern));
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && leaf.test(entry.name)).map((entry) => path.win32.join(dir, entry.name));
  } catch (error) {
    if (!missing_path(error)) console.warn(`[permissions] listing ${dir} for the location pattern ${pattern} failed: ${failure(error)}`);
    return [];
  }
};
