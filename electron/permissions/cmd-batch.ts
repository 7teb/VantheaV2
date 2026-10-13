import path from "node:path";
import { concat, read_env, resolved, unresolved, type Value, type ValueState } from "./command-values.ts";
import type { Word } from "./shell-words.ts";

type CmdSet = { name: string; value: string } | { name: string; poison: string } | null;

export type Search = "path" | "location_then_path" | "none";

const internal = new Set([
  "assoc", "break", "call", "cd", "chdir", "cls", "color", "copy", "date", "del", "dir", "echo", "endlocal", "erase", "exit", "for", "ftype", "goto", "if",
  "md", "mkdir", "mklink", "move", "path", "pause", "popd", "prompt", "pushd", "rd", "rem", "ren", "rename", "rmdir", "set", "setlocal", "shift", "start",
  "time", "title", "type", "ver", "verify", "vol",
]);

const expansion = /%%(?:~[A-Za-z]*)?([A-Za-z])|%%|%~([A-Za-z]*)(\d)|%(\d|\*)|%([^%\r\n]+)%|!([^!\r\n]+)!/g;

const loop_variable = (text: string, letters: string): boolean => Boolean(letters) && new RegExp(`(?<!%)%(?:~[A-Za-z]*)?[${letters}]`).test(text);

export const cmd_name = (word: Word | undefined): string => {
  const piece = word?.pieces.length === 1 ? word.pieces[0] : undefined;
  if (piece?.kind !== "text") return "";
  return piece.text.replace(/^@+/, "").toLowerCase().replace(/^(echo|rem)[.:;,(/\\].*$/, "$1");
};

export const cmd_internal = (name: string): boolean => internal.has(name) || name.startsWith(":");

export const cmd_search = (name: string): Search => (!name || cmd_internal(name) || /[\\/:]/.test(name) ? "none" : "location_then_path");

const batch_part = (modifiers: string, batch_path: string): Value => {
  if (!batch_path) return unresolved("batch file path unknown");
  const mods = modifiers.toLowerCase();
  if (/[satz]/.test(mods)) return unresolved("file attribute expansion");
  const full = path.win32.resolve(batch_path);
  if (!mods || mods === "f") return resolved([full]);
  const parsed = path.win32.parse(full);
  const parts: Record<string, string> = { d: parsed.root.slice(0, 2), p: parsed.dir.slice(2) + "\\", n: parsed.name, x: parsed.ext };
  return resolved([["d", "p", "n", "x"].filter((mod) => mods.includes(mod)).map((mod) => parts[mod] ?? "").join("").replace(/\\\\$/, "\\")]);
};

export const percent_expand = (text: string, state: ValueState, batch_path: string, loop_letters = ""): Value => {
  if (loop_variable(text, loop_letters)) return unresolved("for loop variable");
  const parts: Value[] = [];
  let last = 0;
  for (const match of text.matchAll(expansion)) {
    const [whole, loop, modifiers, numbered, argument, name, delayed] = match;
    parts.push(resolved([text.slice(last, match.index)]));
    last = (match.index ?? 0) + whole.length;
    if (loop) return unresolved("for loop variable");
    if (delayed) return unresolved("delayed expansion");
    if (numbered !== undefined) {
      if (numbered !== "0") return unresolved("batch argument");
      parts.push(batch_part(modifiers ?? "", batch_path));
      continue;
    }
    if (argument !== undefined) {
      if (argument !== "0") return unresolved("batch argument");
      parts.push(batch_part("", batch_path));
      continue;
    }
    if (name !== undefined) {
      parts.push(name.includes(":") ? unresolved("substring or replacement expansion") : read_env(state, name));
      continue;
    }
    parts.push(resolved(["%"]));
  }
  parts.push(resolved([text.slice(last)]));
  return concat(parts);
};

export const cmd_word_value = (word: Word, state: ValueState, batch_path: string, loop_letters = ""): Value => {
  if (word.op) return unresolved("not a string");
  const parts = word.pieces.map((piece): Value => {
    if (piece.kind === "text") return percent_expand(piece.text, state, batch_path, loop_letters);
    if (piece.kind === "group") return concat([resolved(["("]), percent_expand(piece.text, state, batch_path, loop_letters), resolved([")"])]);
    return unresolved("not a string");
  });
  return parts.length === 1 ? (parts[0] as Value) : concat(parts);
};

export const cmd_set = (text: string): CmdSet => {
  const match = /^@?set(?:\s+(\/[ap]))?\s+("?)([^=\s"]+)=([^]*?)\2\s*$/i.exec(text.trim());
  if (!match) return /^@?set\s+\/[ap]\b/i.test(text.trim()) ? { name: "", poison: "set by arithmetic or input" } : null;
  const name = match[3] ?? "";
  return match[1] ? { name, poison: "set by arithmetic or input" } : { name, value: match[4] ?? "" };
};

export const cmd_condition_body = (words: Word[]): number => {
  let index = 1;
  if (/^\/i$/i.test(words[index]?.raw ?? "")) index += 1;
  if (/^not$/i.test(words[index]?.raw ?? "")) index += 1;
  const word = words[index];
  const keyword = (word?.raw ?? "").toLowerCase();
  const start = (at: number) => words[at]?.start ?? -1;
  if (keyword === "exist" || keyword === "defined" || keyword === "errorlevel" || keyword === "cmdextversion") return start(index + 2);
  if (/^(?:==|equ|neq|lss|leq|gtr|geq)$/i.test(words[index + 1]?.raw ?? "")) return start(index + 3);
  if (keyword.endsWith("==")) return start(index + 2);
  const glued = /^(?:"[^"]*"|[^"=\s]+)=="[^"]*"/.exec(word?.raw ?? "")?.[0] ?? "";
  if (word && glued && glued.length < word.raw.length) return word.start + glued.length;
  return keyword.includes("==") ? start(index + 1) : -1;
};

export const cmd_loop_body = (words: Word[]): number => {
  const index = words.findIndex((word, at) => at > 0 && /^do$/i.test(word.raw));
  return index < 0 ? -1 : index + 1;
};
