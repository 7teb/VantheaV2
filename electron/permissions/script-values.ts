import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { SourceLanguage } from "./script-constants.ts";
import { call_arguments, code_mask, top_level } from "./script-text.ts";

export type ValueScope = { file: string; location: string | null; language: SourceLanguage; known: Set<string>; bindings?: Map<string, string> };

type Builtin = { pattern: RegExp; name: string; value: (scope: ValueScope) => string | null };

const quoted = /^(?:[rR](?=["']))?(?:"([^"\r\n]*)"|'([^'\r\n]*)'|`([^`$\r\n]*)`)$/;

const path_wrapper = /^(?:str|Path|pathlib\.Path|PurePath|pathlib\.PurePath|os\.fspath)$/;

const script_folder = (scope: ValueScope): string | null => (scope.file ? path.win32.dirname(scope.file) : null);

const builtins: Record<SourceLanguage, Builtin[]> = {
  python: [
    { pattern: /^__file__$/, name: "__file__", value: (scope) => scope.file || null },
    { pattern: /^sys\.executable$/, name: "sys.executable", value: () => "python" },
    { pattern: /^os\.getcwd\(\s*\)$/, name: "os.getcwd", value: (scope) => scope.location },
    { pattern: /^Path\.cwd\(\s*\)$/, name: "Path.cwd", value: (scope) => scope.location },
    { pattern: /^pathlib\.Path\.cwd\(\s*\)$/, name: "pathlib.Path.cwd", value: (scope) => scope.location },
  ],
  js: [
    { pattern: /^__filename$/, name: "__filename", value: (scope) => scope.file || null },
    { pattern: /^import\.meta\.filename$/, name: "import.meta.filename", value: (scope) => scope.file || null },
    { pattern: /^__dirname$/, name: "__dirname", value: script_folder },
    { pattern: /^import\.meta\.dirname$/, name: "import.meta.dirname", value: script_folder },
    { pattern: /^import\.meta\.url$/, name: "import.meta.url", value: (scope) => (scope.file ? pathToFileURL(scope.file, { windows: true }).href : null) },
    { pattern: /^process\.execPath$/, name: "process.execPath", value: () => "node" },
    { pattern: /^process\.cwd\(\s*\)$/, name: "process.cwd", value: (scope) => scope.location },
  ],
};

const here = (scope: ValueScope): string | null => (scope.known.has("cwd") ? scope.location : null);

const joined = (base: string, part: string): string => (path.win32.isAbsolute(part) ? part : path.win32.join(base, part));

const absolute = (location: string | null, value: string): string | null =>
  path.win32.isAbsolute(value) ? path.win32.resolve(value) : location === null ? null : path.win32.resolve(location, value);

const parent = (location: string | null, value: string, levels: number): string | null => {
  let folder = absolute(location, value);
  for (let level = 0; level < levels && folder !== null; level += 1) folder = path.win32.dirname(folder);
  return folder;
};

const file_path = (url: string): string | null => {
  try {
    return fileURLToPath(url, { windows: true });
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
};

const url_value = (relative: string, base: string): string | null => {
  if (!base.startsWith("file:")) return null;
  const target = URL.parse(relative, base);
  return target?.protocol === "file:" ? file_path(target.href) : null;
};

const call_value = (name: string, args: string[], scope: ValueScope): string | null => {
  const [first = "", second] = args;
  if (!scope.known.has(name === "new URL" ? "URL" : name)) return null;
  if (scope.language === "python") {
    if (path_wrapper.test(name) || name === "os.path.join") return args.reduce(joined);
    if (/^os\.path\.(?:abspath|realpath|normpath)$/.test(name) && args.length === 1) return parent(here(scope), first, 0);
    if (name === "os.path.dirname" && args.length === 1) return parent(here(scope), first, 1);
    if (/^(?:shutil\.)?which$/.test(name) && args.length === 1) return first;
    return null;
  }
  if (name === "path.join") return path.win32.join(...args);
  if (name === "path.resolve") {
    if (args.some((arg) => path.win32.isAbsolute(arg))) return path.win32.resolve(...args);
    const location = here(scope);
    return location === null ? null : path.win32.resolve(location, ...args);
  }
  if (name === "path.dirname" && args.length === 1) return path.win32.dirname(first);
  if (name === "new URL" && second !== undefined && args.length === 2) return url_value(first, second);
  if (!/^(?:url\.)?fileURLToPath$/.test(name) || args.length !== 1) return null;
  if (first.startsWith("file:")) return file_path(first);
  return path.win32.isAbsolute(first) ? first : null;
};

export const script_value = (expression: string, scope: ValueScope, depth = 0): string | null => {
  const text = expression.trim();
  if (!text || depth > 8) return null;
  const next = (inner: string) => script_value(inner, scope, depth + 1);
  const python = scope.language === "python";
  const parts = python ? top_level(text, "/", "python") : [];
  if (parts.length > 1) {
    const each = parts.map(next);
    return each.every((part) => part !== null) ? (each as string[]).reduce(joined) : null;
  }
  const literal = quoted.exec(text);
  if (literal) return literal[1] ?? literal[2] ?? literal[3] ?? "";
  if (text.startsWith("(") && call_arguments(text, 1).length === text.length - 2) return next(text.slice(1, -1));
  const builtin = builtins[scope.language].find((entry) => entry.pattern.test(text));
  if (builtin) return scope.known.has(builtin.name) ? builtin.value(scope) : null;
  const bound = scope.bindings?.get(text);
  if (bound !== undefined) return next(bound);
  const members = python ? top_level(text, ".", "python") : [];
  const member = members.length > 1 ? /^\s*(parent|parents\[(\d)\]|resolve\(\s*\)|absolute\(\s*\)|with_name\(([\s\S]*)\))\s*$/.exec(members.at(-1) ?? "") : null;
  if (member && scope.known.has("." + (/^\w+/.exec(member[1] ?? "")?.[0] ?? ""))) {
    const base = next(members.slice(0, -1).join("."));
    if (base === null) return null;
    if (member[3] !== undefined) {
      const name = next(member[3]);
      return name === null || /[\\/]/.test(name) ? null : path.win32.join(path.win32.dirname(base), name);
    }
    const levels = member[1] === "parent" ? 1 : member[2] ? Number(member[2]) + 1 : 0;
    return parent(here(scope), base, levels);
  }
  if (member) return null;
  const call = /^(new\s+URL|[\w.]+)\s*\(/.exec(text);
  const inner = call ? call_arguments(text, call[0].length) : "";
  if (!call || call[0].length + inner.length !== text.length - 1) return null;
  const args = top_level(inner, ",", scope.language).map((arg) => arg.trim()).filter(Boolean).map(next);
  if (!args.length || args.some((arg) => arg === null)) return null;
  return call_value((call[1] ?? "").replace(/^new\s+/, "new "), args as string[], scope);
};

export const quoted_value = (value: string): string => `"${value}${value.endsWith("\\") ? "\\" : ""}"`;

const top_index = (masked: string, from: number, found: (index: number) => boolean): number => {
  let depth = 0;
  for (let index = from; index < masked.length; index += 1) {
    const char = masked[index] ?? "";
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (depth === 0 && found(index)) return index;
  }
  return -1;
};

const branches = (text: string, language: SourceLanguage): [string, string] | null => {
  const masked = code_mask(text, language);
  if (language === "python") {
    const keyword = (word: string) => (index: number) => masked.startsWith(word, index) && !/[\w.]/.test(masked[index - 1] ?? "") && !/\w/.test(masked[index + word.length] ?? "");
    const condition = top_index(masked, 0, keyword("if"));
    const otherwise = condition < 0 ? -1 : top_index(masked, condition + 2, keyword("else"));
    return otherwise < 0 ? null : [text.slice(0, condition), text.slice(otherwise + 4)];
  }
  const question = (index: number) => masked[index] === "?" && !/[?.]/.test(masked[index + 1] ?? "") && masked[index - 1] !== "?";
  const condition = top_index(masked, 0, question);
  if (condition < 0) return null;
  let open = 0;
  const colon = top_index(masked, condition + 1, (index) => {
    if (question(index)) open += 1;
    else if (masked[index] === ":") open -= 1;
    return open < 0;
  });
  return colon < 0 ? null : [text.slice(condition + 1, colon), text.slice(colon + 1)];
};

export const script_values = (expression: string, scope: ValueScope, depth = 0): string[] | null => {
  const text = expression.trim();
  const inner = text.startsWith("(") && call_arguments(text, 1).length === text.length - 2 ? text.slice(1, -1) : text;
  const split = depth > 4 ? null : branches(inner, scope.language);
  if (!split) {
    const value = script_value(text, scope);
    return value === null ? null : [value];
  }
  const each = split.map((branch) => script_values(branch, scope, depth + 1));
  if (each.some((values) => values === null)) return null;
  const values = [...new Set((each as string[][]).flat())];
  return values.length > 8 ? null : values;
};

export const alternatives_text = (values: string[], language: SourceLanguage): string => {
  const [head = "", ...rest] = values.map(quoted_value);
  return rest.reduce((text, value) => (language === "python" ? `(${text} if 0 else ${value})` : `(0 ? ${text} : ${value})`), head);
};
