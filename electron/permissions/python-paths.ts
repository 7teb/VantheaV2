import path from "node:path";
import { name_writes, script_shape, statement_end, type ScriptShape } from "./script-scopes.ts";
import { call_arguments, code_mask, top_level } from "./script-text.ts";
import { known_globals } from "./script-globals.ts";
import { script_value, type ValueScope } from "./script-values.ts";

export type ImportFolders = { first: string[]; last: string[]; gaps: string[] };

const path_change = /(?<![\w.])sys\s*\.\s*path\s*\.\s*(insert|append)\s*\(/g;

const path_bindings = (text: string, shape: ScriptShape): Map<string, string> => {
  const { masked } = shape;
  const clean = code_mask(text, "python", false);
  const whole = { start: 0, end: masked.length };
  const found = new Map<string, string>();
  for (const match of masked.matchAll(/^([A-Za-z_]\w*)[ \t]*=(?!=)/gm)) {
    const name = match[1] ?? "";
    const start = (match.index ?? 0) + match[0].length;
    const end = statement_end(masked, start, "python");
    if (end !== null && name_writes(shape, name, whole) === 1) found.set(name, clean.slice(start, end).trim());
  }
  return found;
};

export const import_folders = (text: string, file: string, location: string): ImportFolders => {
  const found: ImportFolders = { first: [], last: [], gaps: [] };
  const masked = code_mask(text, "python");
  const shape = script_shape(masked, "python");
  const scope: ValueScope = { file, location, language: "python", known: known_globals(shape, text), bindings: path_bindings(text, shape) };
  for (const match of masked.matchAll(path_change)) {
    const start = (match.index ?? 0) + match[0].length;
    const inner = call_arguments(text, start);
    const insert = match[1] === "insert";
    const args = top_level(inner, ",");
    const folder = script_value((insert ? args[1] : args[0]) ?? "", scope);
    if (folder === null) {
      found.gaps.push(`Import path could not be resolved: ${text.slice(match.index ?? 0, start)}${inner.slice(0, 200)}) in ${file || "python -c code"}.`);
      continue;
    }
    const full = path.win32.resolve(location, folder);
    if (insert) found.first.unshift(full);
    else found.last.push(full);
  }
  return found;
};
