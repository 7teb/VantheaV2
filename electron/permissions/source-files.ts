import fs from "node:fs/promises";
import path from "node:path";
import type { ScriptRole } from "../../shared/review.ts";
import { is_inside, is_secret_path, to_posix } from "../project/scope.ts";
import { error_code } from "../storage/coerce.ts";
import { path_key } from "../storage/paths.ts";
import { network_path } from "./launch-targets.ts";
import { read_limit_bytes, read_source, type ScriptPin } from "./source-read.ts";
import type { ScriptFile } from "./sources.ts";
import { change_mark, write_entry } from "./written-files.ts";

export type FileScope = { root: string; chat_id: string; chat_started_at: number; gap: (reason: string) => void };

const analysed_files = 32;

const listed_files = 200;

const role_rank: Record<ScriptRole, number> = { payload: 5, started: 4, manifest: 3, input: 2, loaded: 1, named: 0 };

export const send_candidate = (file: ScriptFile): boolean =>
  file.text !== null && (file.role === "started" || file.role === "manifest" || file.role === "payload" || file.role === "input" || file.change !== null);

export const source_files = (scope: FileScope) => {
  const files: ScriptFile[] = [];
  const by_key = new Map<string, ScriptFile>();
  const pins = new Map<string, ScriptPin>();
  let analysed = 0;
  let listed = 0;
  let unlisted = 0;
  const inside = (file: string) => scope.root !== "" && is_inside(scope.root, file);
  const pin = (file: string, sha256: string | null) => pins.set(path_key(file), { path: file, sha256 });
  const touch = async (file: string, role: ScriptRole, required: boolean, reach_outside = false): Promise<ScriptFile | null> => {
    const target = path.resolve(file);
    const known = by_key.get(path_key(target));
    if (known) {
      if (role_rank[role] > role_rank[known.role]) known.role = role;
      return known;
    }
    const outside = !inside(target);
    const open = !outside || role === "started" || reach_outside;
    if (!open || is_secret_path(target)) {
      if (required || (open && outside)) scope.gap("Source is outside the project or protected: " + target);
      return null;
    }
    if (outside && network_path(target)) {
      scope.gap("Source is on a network path and was not read: " + target);
      return null;
    }
    const analysed_role = role === "started" || role === "manifest";
    if (analysed_role ? analysed >= analysed_files : listed >= listed_files) {
      if (analysed_role) scope.gap("Source file limit exceeded (" + analysed_files + "): " + target);
      else if (required || role === "input" || write_entry(scope.chat_id, target)) scope.gap("Loaded file limit exceeded (" + listed_files + "): " + target);
      else unlisted += 1;
      return null;
    }
    try {
      const real = await fs.realpath(target);
      if ((outside ? network_path(real) : !inside(real)) || is_secret_path(real)) {
        scope.gap((outside ? "Source links to a network path or a protected file: " : "Source links outside the project or to a protected file: ") + target);
        return null;
      }
      const read = await read_source(real);
      if (analysed_role) analysed += 1;
      else listed += 1;
      const entry: ScriptFile = {
        id: `s${files.length + 1}`,
        path: outside ? real : to_posix(path.relative(scope.root, real)),
        abs: real,
        outside,
        role,
        sha256: read.sha256,
        bytes: read.bytes,
        chars: read.text?.length ?? 0,
        text: read.text,
        binary: read.binary,
        over_limit: read.over_limit,
        change: change_mark(scope.chat_id, scope.chat_started_at, real, read.sha256, read),
      };
      files.push(entry);
      by_key.set(path_key(target), entry);
      pin(real, read.sha256);
      const forcing = required || entry.change?.kind === "written" || (role === "input" && entry.change !== null);
      if (read.over_limit && !read.binary && forcing) scope.gap("Source file exceeds the read limit (" + read_limit_bytes.toLocaleString("en-US") + " bytes): " + target);
      return entry;
    } catch (error) {
      if (error_code(error) === "ENOENT") pin(target, null);
      if (required || error_code(error) !== "ENOENT") scope.gap("Source is unavailable: " + target + " (" + error_code(error) + ")");
      return null;
    }
  };
  return { files, pins, inside, pin, touch, unlisted: () => unlisted, listed_limit: listed_files };
};
