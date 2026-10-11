import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { error_code, error_text, missing_path } from "../storage/coerce.ts";
import { script_extension, type ModuleRef } from "./script-refs.ts";

export type Loads = { files: string[]; gaps: string[] };

const walk_limit = 5000;

const skipped_dirs = new Set([".git", "node_modules"]);

const js_extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx"];

const failure = (error: unknown): string => error_code(error) || error_text(error);

const is_file = async (file: string): Promise<boolean> => {
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

const resolve_python = (bases: string[], dotted: string): Promise<string | null> => {
  const parts = dotted.split(".").filter(Boolean);
  if (!parts.length) {
    return Promise.resolve(null);
  }
  return first_file(bases.flatMap((base) => [path.join(base, ...parts) + ".py", path.join(base, ...parts, "__init__.py")]));
};

const strip_comments = (text: string, python: boolean): string =>
  python ? text.replace(/#[^\r\n]*/g, "") : text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\"'])\/\/[^\r\n]*/g, "$1");

const literal = (expression: string): string | null => {
  const match = /^\s*(["'])([^"'\r\n]+)\1\s*$/.exec(expression) ?? /^\s*`([^`$\r\n]+)`\s*$/.exec(expression);
  return match ? (match[2] ?? match[1] ?? null) : null;
};

const relative_spec = (spec: string) => /^\.{1,2}[\\/]/.test(spec) || path.isAbsolute(spec);

const js_imports = async (text: string, file: string): Promise<Loads> => {
  const code = strip_comments(text, false);
  const specs: string[] = [];
  const gaps: string[] = [];
  for (const match of code.matchAll(/(?:^|[;\n}])\s*(?:import|export)\s[^;'"`]*?\bfrom\s*(["'])([^"'\r\n]+)\1/g)) specs.push(match[2] ?? "");
  for (const match of code.matchAll(/(?:^|[;\n])\s*import\s*(["'])([^"'\r\n]+)\1/g)) specs.push(match[2] ?? "");
  for (const match of code.matchAll(/(?<![\w.$])(?:import|require)\s*\(([^()]*)\)/g)) {
    const spec = literal(match[1] ?? "");
    if (spec === null) gaps.push(`Import could not be resolved: ${(match[0] ?? "").slice(0, 200)} in ${file}.`);
    else specs.push(spec);
  }
  const files: string[] = [];
  for (const spec of new Set(specs.filter(relative_spec))) {
    try {
      const found = await resolve_js(path.dirname(file), spec);
      if (found) files.push(found);
    } catch (error) {
      gaps.push(`Import could not be checked: ${spec} in ${file} (${failure(error)}).`);
    }
  }
  return { files, gaps };
};

const python_imports = async (text: string, file: string, location: string): Promise<Loads> => {
  const code = strip_comments(text, true);
  const here = path.dirname(file);
  const files: string[] = [];
  const gaps: string[] = [];
  const add = async (bases: string[], dotted: string) => {
    try {
      const found = await resolve_python(bases, dotted);
      if (found) files.push(found);
    } catch (error) {
      gaps.push(`Import could not be checked: ${dotted} in ${file} (${failure(error)}).`);
    }
  };
  for (const match of code.matchAll(/^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm)) {
    for (const name of (match[1] ?? "").split(",")) await add([here, location], name.trim());
  }
  for (const match of code.matchAll(/^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+\(?([\w, \t*]+)/gm)) {
    const dots = (match[1] ?? "").length;
    const module_name = match[2] ?? "";
    const base = dots ? path.resolve(here, ...Array<string>(Math.max(0, dots - 1)).fill("..")) : null;
    if (module_name) {
      await add(base ? [base] : [here, location], module_name);
    } else if (base) {
      for (const name of (match[3] ?? "").split(",")) await add([base], name.trim());
    }
  }
  for (const match of code.matchAll(/\b(?:importlib\s*\.\s*import_module|__import__)\s*\(([^()]*)\)/g)) {
    if (literal((match[1] ?? "").split(",")[0] ?? "") === null) gaps.push(`Import could not be resolved: ${(match[0] ?? "").slice(0, 200)} in ${file}.`);
  }
  return { files, gaps };
};

export const local_imports = (text: string, file: string, location: string): Promise<Loads> => {
  if (/\.(?:py|pyw)$/i.test(file)) {
    return python_imports(text, file, location);
  }
  if (/\.(?:[cm]?[jt]sx?)$/i.test(file)) {
    return js_imports(text, file);
  }
  return Promise.resolve({ files: [], gaps: [] });
};

export const resolve_module = (module: ModuleRef, location: string): Promise<string | null> => {
  if (!module.spec) {
    return Promise.resolve(null);
  }
  if (module.kind === "python") {
    const parts = module.spec.split(".").filter(Boolean);
    return first_file([path.join(location, ...parts) + ".py", path.join(location, ...parts, "__main__.py"), path.join(location, ...parts, "__init__.py")]);
  }
  return resolve_js(location, module.spec);
};

const glob_pattern = (glob: string): RegExp => {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index] ?? "";
    if (char === "*" && glob[index + 1] === "*") {
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

export const expand_entry = async (entry: string, location: string): Promise<Loads | null> => {
  const posix = entry.replaceAll("\\", "/").replace(/^\.\//, "");
  const glob = /[*?]/.test(posix);
  const prefix = glob ? posix.slice(0, posix.search(/[*?]/)).replace(/[^/]*$/, "") : posix;
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
    if (script_extension.test(file) && (!pattern || pattern.test(relative))) files.push(file);
  }, gaps);
  return { files: files.sort(), gaps: complete ? gaps : [...gaps, `Directory or pattern walk exceeded ${walk_limit.toLocaleString("en-US")} entries: ${entry}.`] };
};
