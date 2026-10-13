import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { error_code, error_text, missing_path } from "../storage/coerce.ts";
import { import_folders } from "./python-paths.ts";
import { script_constants, source_language, substitute, values_at, type Constants, type SourceLanguage } from "./script-constants.ts";
import { script_extension, type ModuleRef } from "./script-refs.ts";
import { call_arguments, code_mask } from "./script-text.ts";

export type Loads = { files: string[]; gaps: string[] };

export type ModuleTarget = { kind: "file"; file: string } | { kind: "installed" } | { kind: "missing"; file: string };

const walk_limit = 5000;

const skipped_dirs = new Set([".git", "node_modules"]);

const js_extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx"];

const failure = (error: unknown): string => error_code(error) || error_text(error);

export const is_file = async (file: string): Promise<boolean> => {
  try {
    return (await fs.stat(file)).isFile();
  } catch (error) {
    if (missing_path(error)) return false;
    throw error;
  }
};

const first_file = async (candidates: string[]): Promise<string | null> => {
  for (const candidate of candidates) {
    if (await is_file(candidate)) {
      return candidate;
    }
  }
  return null;
};

const resolve_js = (base: string, spec: string): Promise<string | null> => {
  const target = path.resolve(base, spec);
  const typed = /\.[cm]?js$/.test(target) ? [target.replace(/\.([cm]?)js$/, ".$1ts"), target.replace(/\.js$/, ".tsx")] : [];
  return first_file([target, ...typed, ...js_extensions.map((ext) => target + ext), ...js_extensions.map((ext) => path.join(target, `index${ext}`))]);
};

const resolve_python = async (bases: string[], dotted: string): Promise<string[]> => {
  const parts = dotted.split(".").filter(Boolean);
  for (const base of parts.length ? bases : []) {
    const found = await first_file([path.join(base, ...parts) + ".py", path.join(base, ...parts, "__init__.py")]);
    if (!found) continue;
    const packages = await Promise.all(parts.slice(0, -1).map((_, index) => first_file([path.join(base, ...parts.slice(0, index + 1), "__init__.py")])));
    return [...packages.filter((file): file is string => file !== null), found];
  }
  return [];
};

const strip_comments = (text: string, python: boolean): string =>
  python ? text.replace(/#[^\r\n]*/g, "") : text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\"'])\/\/[^\r\n]*/g, "$1");

const literal = (expression: string): string | null => {
  const match = /^\s*(["'])([^"'\r\n]+)\1\s*$/.exec(expression) ?? /^\s*`([^`$\r\n]+)`\s*$/.exec(expression);
  return match ? (match[2] ?? match[1] ?? null) : null;
};

const relative_spec = (spec: string) => /^\.{1,2}[\\/]/.test(spec) || path.isAbsolute(spec);

const js_imports = async (text: string, file: string, location: string): Promise<Loads> => {
  const code = strip_comments(text, false);
  const where = file || "node -e code";
  const specs: string[] = [];
  const gaps: string[] = [];
  for (const match of code.matchAll(/(?:^|[;\n}])\s*(?:import|export)\s[^;'"`]*?\bfrom\s*(["'])([^"'\r\n]+)\1/g)) specs.push(match[2] ?? "");
  for (const match of code.matchAll(/(?:^|[;\n])\s*import\s*(["'])([^"'\r\n]+)\1/g)) specs.push(match[2] ?? "");
  let constants: Constants | null = null;
  for (const match of code_mask(text, "js").matchAll(/(?<![\w.$])(?:import|require)\s*\(/g)) {
    const inner = call_arguments(text, (match.index ?? 0) + match[0].length);
    const spec = literal(substitute(inner, values_at((constants ??= script_constants(text, "js", file)), match.index ?? 0)));
    if (spec === null) gaps.push(`Import could not be resolved: ${(match[0] + inner + ")").slice(0, 200)} in ${where}.`);
    else specs.push(spec);
  }
  const files: string[] = [];
  for (const spec of new Set(specs.filter(relative_spec))) {
    try {
      const found = await resolve_js(file ? path.dirname(file) : location, spec);
      if (found) files.push(found);
    } catch (error) {
      gaps.push(`Import could not be checked: ${spec} in ${where} (${failure(error)}).`);
    }
  }
  return { files, gaps };
};

export const python_imports = async (text: string, file: string, location: string): Promise<Loads> => {
  const code = strip_comments(text, true);
  const here = file ? path.dirname(file) : location;
  const where = file || "python -c code";
  const folders = import_folders(text, file, location);
  const bases = [...new Set([...folders.first, here, location, ...folders.last])];
  const files: string[] = [];
  const gaps: string[] = [...folders.gaps];
  const relative_base = (dots: number) => path.resolve(here, ...Array<string>(Math.max(0, dots - 1)).fill(".."));
  const add = async (from: string[], dotted: string) => {
    try {
      files.push(...(await resolve_python(from, dotted)));
    } catch (error) {
      gaps.push(`Import could not be checked: ${dotted} in ${where} (${failure(error)}).`);
    }
  };
  for (const match of code.matchAll(/(?:^|;)[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm)) {
    for (const name of (match[1] ?? "").split(",")) await add(bases, name.trim());
  }
  for (const match of code.matchAll(/(?:^|;)[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+\(?([\w, \t*]+)/gm)) {
    const dots = (match[1] ?? "").length;
    const module_name = match[2] ?? "";
    const from = dots ? [relative_base(dots)] : bases;
    if (module_name) await add(from, module_name);
    if (!module_name && !dots) continue;
    for (const name of (match[3] ?? "").split(",").map((entry) => entry.trim().split(/\s/)[0] ?? "")) {
      if (name && name !== "*") await add(from, module_name ? module_name + "." + name : name);
    }
  }
  let constants: Constants | null = null;
  for (const match of code_mask(text, "python", false).matchAll(/\b(?:importlib\s*\.\s*import_module|__import__)\s*\(([^()]*)\)/g)) {
    const spec = literal(substitute((match[1] ?? "").split(",")[0] ?? "", values_at((constants ??= script_constants(text, "python", file)), match.index ?? 0)));
    if (spec === null) {
      gaps.push(`Import could not be resolved: ${(match[0] ?? "").slice(0, 200)} in ${where}.`);
      continue;
    }
    const dots = /^\.*/.exec(spec)?.[0].length ?? 0;
    await add(dots ? [relative_base(dots)] : bases, spec.slice(dots));
  }
  return { files: [...new Set(files)], gaps };
};

export const code_imports = (text: string, language: SourceLanguage, location: string): Promise<Loads> =>
  language === "python" ? python_imports(text, "", location) : js_imports(text, "", location);

export const local_imports = (text: string, file: string, location: string, language: SourceLanguage | null = null): Promise<Loads> => {
  const kind = language ?? source_language(file);
  if (kind === "python") return python_imports(text, file, location);
  if (kind === "js") return js_imports(text, file, location);
  return Promise.resolve({ files: [], gaps: [] });
};

export const entry_file = async (entry: string, location: string, language: SourceLanguage | null): Promise<string | null> =>
  language === "js" ? resolve_js(location, entry) : first_file([path.resolve(location, entry)]);

export const resolve_module = async (module: ModuleRef, location: string): Promise<ModuleTarget> => {
  if (module.kind === "python") {
    const parts = module.spec.split(".").filter(Boolean);
    const file = await first_file([path.join(location, ...parts) + ".py", path.join(location, ...parts, "__main__.py"), path.join(location, ...parts, "__init__.py")]);
    return file ? { kind: "file", file } : { kind: "installed" };
  }
  if (!relative_spec(module.spec)) return { kind: "installed" };
  const file = await resolve_js(location, module.spec);
  return file ? { kind: "file", file } : { kind: "missing", file: path.resolve(location, module.spec) };
};

export const glob_pattern = (glob: string): RegExp => {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index] ?? "";
    const close = char === "[" ? glob.indexOf("]", index + 2) : -1;
    if (close > 0) {
      const body = glob.slice(index + 1, close);
      const negated = body.startsWith("!");
      source += "[" + (negated ? "^" : "") + (negated ? body.slice(1) : body).replace(/[\\^]/g, "\\$&") + "]";
      index = close;
    } else if (char === "*" && glob[index + 1] === "*") {
      const slash = glob[index + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      index += slash ? 2 : 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`, "i");
};

const read_dir = async (dir: string, gaps: string[]): Promise<Dirent[]> => {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (!missing_path(error)) gaps.push(`Directory could not be read: ${dir} (${failure(error)}).`);
    return [];
  }
};

const walk = async (dir: string, visit: (file: string) => void, gaps: string[]): Promise<boolean> => {
  let seen = 0;
  const pending = [dir];
  while (pending.length) {
    const current = pending.pop() ?? "";
    const entries = await read_dir(current, gaps);
    for (const entry of entries) {
      seen += 1;
      if (seen > walk_limit) {
        return false;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && !skipped_dirs.has(entry.name)) pending.push(full);
      else if (entry.isFile()) visit(full);
    }
  }
  return true;
};

export const expand_entry = async (entry: string, location: string, accept: RegExp = script_extension): Promise<Loads | null> => {
  const posix = entry.replaceAll("\\", "/").replace(/^\.\//, "");
  const glob = /[*?[]/.test(posix);
  const prefix = glob ? posix.slice(0, posix.search(/[*?[]/)).replace(/[^/]*$/, "") : posix;
  const base = path.resolve(location, prefix || ".");
  if (!glob) {
    try {
      if (!(await fs.stat(base)).isDirectory()) return null;
    } catch (error) {
      if (missing_path(error)) return null;
      return { files: [], gaps: [`Interpreter entry source could not be read: ${entry} (${failure(error)}).`] };
    }
  }
  const pattern = glob ? glob_pattern(posix) : null;
  const files: string[] = [];
  const gaps: string[] = [];
  const complete = await walk(base, (file) => {
    const relative = path.relative(location, file).replaceAll("\\", "/");
    if (accept.test(file) && (!pattern || pattern.test(relative))) files.push(file);
  }, gaps);
  return { files: files.sort(), gaps: complete ? gaps : [...gaps, `Directory or pattern walk exceeded ${walk_limit.toLocaleString("en-US")} entries: ${entry}.`] };
};
