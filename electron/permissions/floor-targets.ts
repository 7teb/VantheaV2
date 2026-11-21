import path from "node:path";
import { in_project, type FloorScope } from "./floor-shared.ts";
import { shell_words, type Piece, type Word } from "./shell-words.ts";

export type Walk = { scope: FloorScope; location: string | null; variables: Map<string, string>; app_variables: Set<string> };

export type Command = { text: string; verb: string; words: Word[]; args: Word[] };

const lone_variable = /^\$(?:\{[^}]+\}|[a-z_][\w:]*)$/i;

const app_path = /(?:%appdata%|\$env:appdata|\$\{env:appdata\}|\$\(\s*(?:\$env:appdata|\$\{env:appdata\})\s*\)|appdata[\\/]roaming)[\\/]vantheax/i;

export const assignment = /^\s*\$([a-z_][\w:]*)\s*=\s*([\s\S]+)$/i;

export const variable_use = /\$([a-z_][\w:]*)/gi;

export const joined_literal = (text: string) => text.replace(/["']\s*\+\s*["']/g, "").replace(/["']/g, "");

const mentions_app = (text: string) => app_path.test(text) || app_path.test(joined_literal(text));

const env_value = (name: string): string | null => process.env[name] || null;

const expansions: [RegExp, string][] = [
  [/%appdata%|\$\{env:appdata\}|\$env:appdata\b/gi, "APPDATA"],
  [/%systemdrive%|\$\{env:systemdrive\}|\$env:systemdrive\b/gi, "SYSTEMDRIVE"],
  [/%userprofile%|\$\{env:userprofile\}|\$env:userprofile\b|\$\{home\}|\$home\b/gi, "USERPROFILE"],
];

export const expand = (token: string, variables: Map<string, string>): string | null => {
  const home = env_value("USERPROFILE");
  let value = home ? token.replace(/^~(?=$|[\\/])/, home) : token;
  for (const [pattern, name] of expansions) {
    const real = variables.get("env:" + name.toLowerCase()) ?? env_value(name);
    value = real ? value.replace(pattern, real) : value;
  }
  value = value.replace(/\$\{?([a-z_]\w*)\}?/gi, (match, name: string) => variables.get(name.toLowerCase()) ?? match);
  return value && !/[$%`]/.test(value) ? value : null;
};

const piece_text = (piece: Piece): string | null => {
  if (piece.kind === "text") {
    return piece.text;
  }
  const inner = piece.kind === "group" && piece.open === "$(" ? piece.text.trim() : "";
  return lone_variable.test(inner) ? inner : null;
};

export const literal = (word: Word): string | null => {
  if (word.op || !word.pieces.length) {
    return null;
  }
  let text = "";
  for (const piece of word.pieces) {
    const part = piece_text(piece);
    if (part === null) {
      return null;
    }
    text += part;
  }
  return text;
};

export const resolve_target = (token: string, walk: Walk): string | null => {
  const expanded = expand(token.trim(), walk.variables);
  if (expanded === null || (walk.location === null && !path.win32.isAbsolute(expanded))) {
    return null;
  }
  return path.win32.resolve(walk.location ?? "", expanded);
};

export const unexplained = (text: string, walk: Walk): boolean => {
  if (!mentions_app(text)) {
    return false;
  }
  const words = shell_words(text, "powershell").filter((word) => mentions_app(word.raw));
  return !words.length || words.some((word) => unexplained_word(word, walk));
};

const unexplained_word = (word: Word, walk: Walk): boolean => {
  const text = literal(word);
  if (text !== null) {
    return !in_project(resolve_target(text, walk), walk.scope);
  }
  return word.pieces.some((piece) => (piece.kind === "text" ? mentions_app(piece.text) : piece.kind !== "splat" && unexplained(piece.text, walk)));
};

export const uses_app_variable = (text: string, walk: Walk) => [...text.matchAll(variable_use)].some((match) => walk.app_variables.has((match[1] ?? "").toLowerCase()));

export const command_of = (statement: string): Command => {
  let text = statement.trim();
  for (let assigned = assignment.exec(text); assigned; assigned = assignment.exec(text)) {
    text = (assigned[2] ?? "").trim();
  }
  const words = shell_words(text, "powershell");
  const at = words[0]?.raw === "&" ? 1 : 0;
  const head = words[at];
  return { text, verb: head ? (literal(head) ?? "") : "", words, args: words.slice(at + 1) };
};
