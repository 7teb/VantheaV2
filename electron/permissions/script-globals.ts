import type { SourceLanguage } from "./script-constants.ts";
import { name_writes, type Scope, type ScriptShape } from "./script-scopes.ts";

export const dynamic_scope: Record<SourceLanguage, RegExp> = {
  python: /(?<![\w.])(?:globals|vars|exec|eval|setattr)\s*\(|^[ \t]*from[ \t]+\S+[ \t]+import[ \t]+\*/m,
  js: /(?<![\w.$])(?:eval|with)\s*\(/,
};

const reflective: Record<SourceLanguage, RegExp> = {
  python: /__dict__|__builtins__|__setattr__|(?<![\w.])sys\s*\.\s*modules\b/,
  js: /(?<![\w$.])(?:Function\s*\(|globalThis\b|global\s*[.[])/,
};

const python_names = [
  "__file__", "sys.executable", "os.getcwd", "Path.cwd", "pathlib.Path.cwd", "str", "Path", "pathlib.Path", "PurePath", "pathlib.PurePath",
  "os.fspath", "os.path.join", "os.path.abspath", "os.path.realpath", "os.path.normpath", "os.path.dirname", "shutil.which", "which",
  ".parent", ".parents", ".resolve", ".absolute", ".with_name", "cwd",
];

const python_sources: Record<string, string> = { which: "shutil", Path: "pathlib", PurePath: "pathlib" };

const location_names = new Set(["os.getcwd", "Path.cwd", "pathlib.Path.cwd", "cwd", "process.cwd"]);

type JsRoot = { modules: string[]; imported: string[]; global: boolean; use: "member" | "construct" | "any" };

const js_roots: Record<string, JsRoot> = {
  path: { modules: ["path", "node:path"], imported: ["default", "*"], global: false, use: "member" },
  url: { modules: ["url", "node:url"], imported: ["default", "*"], global: false, use: "member" },
  fileURLToPath: { modules: ["url", "node:url"], imported: ["fileURLToPath"], global: false, use: "any" },
  URL: { modules: ["url", "node:url"], imported: ["URL"], global: true, use: "construct" },
  process: { modules: ["process", "node:process"], imported: ["default", "*"], global: true, use: "member" },
  __dirname: { modules: [], imported: [], global: true, use: "any" },
  __filename: { modules: [], imported: [], global: true, use: "any" },
};

const js_names = [
  "__filename", "__dirname", "import.meta.filename", "import.meta.dirname", "import.meta.url", "process.execPath", "process.cwd",
  "path.join", "path.resolve", "path.dirname", "URL", "fileURLToPath", "url.fileURLToPath", "cwd",
];

type JsBinding = Scope & { local: string; imported: string; module: string; required: boolean };

const js_assign_op = String.raw`(?:(?:[-+*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?)?=(?![=>])|\+\+|--)`;

const js_chain = String.raw`((?:\s*\??\.\s*[\w$]+|\s*\[[^\]]*\])+)`;

const module_spec = (text: string, at: number): { spec: string; end: number } | null => {
  const found = /^\s*(["'`])([^"'`\r\n]*)\1/.exec(text.slice(at));
  return found ? { spec: found[2] ?? "", end: at + found[0].length } : null;
};

const python_imported = (masked: string, name: string): { exact: number; dotted: number } => {
  const found = { exact: 0, dotted: 0 };
  for (const match of masked.matchAll(/(?:^|;)[ \t]*import[ \t]+([^\n;]+)/gm)) {
    for (const item of (match[1] ?? "").split(",").map((entry) => entry.trim())) {
      if (item === name) found.exact += 1;
      else if (item.startsWith(name + ".") && /^[\w.]+$/.test(item)) found.dotted += 1;
    }
  }
  const source = python_sources[name];
  if (!source) return found;
  for (const match of masked.matchAll(/(?:^|;)[ \t]*from[ \t]+([\w.]+)[ \t]+import[ \t]+(\([^)]*\)|[^\n;]+)/gm)) {
    if (match[1] === source) found.exact += (match[2] ?? "").replace(/[()]/g, "").split(",").filter((item) => item.trim() === name).length;
  }
  return found;
};

const python_patched = ({ masked, targets }: ScriptShape): Set<string> => {
  const regions = targets.map((target) => masked.slice(target.start, target.end));
  for (const match of masked.matchAll(/(?<![\w.])del\b([^\n;]*)|(?<![\w.])for\b((?:(?!\bin\b)[^\n:])*)\bin\b|(?<![\w.])as[ \t]+([\w. \t]+)/g)) {
    regions.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return new Set(regions.flatMap((region) => [...region.matchAll(/\.\s*([A-Za-z_]\w*)/g)].map((match) => match[1] ?? "")));
};

const python_trust = (shape: ScriptShape): Set<string> => {
  const { masked } = shape;
  const full = { start: 0, end: masked.length };
  const patched = python_patched(shape);
  if ([...patched].some((name) => name.startsWith("__"))) return new Set();
  const moved = /(?<![\w])chdir\s*\(/.test(masked);
  const bound = new Map<string, boolean>();
  const root_bound = (root: string): boolean => {
    if (root === "__file__") return name_writes(shape, root, full) === 0;
    const writes = name_writes(shape, root, full, true);
    if (root === "str") return writes === 0;
    const imported = python_imported(masked, root);
    return imported.exact + imported.dotted > 0 && writes === imported.exact;
  };
  return new Set(python_names.filter((name) => {
    if (moved && location_names.has(name)) return false;
    const parts = name.split(".").filter(Boolean);
    if (parts.some((part) => patched.has(part))) return false;
    if (name.startsWith(".") || name === "cwd") return true;
    const root = parts[0] ?? "";
    if (!bound.has(root)) bound.set(root, root_bound(root));
    return bound.get(root) === true;
  }));
};

const js_bindings = (text: string, masked: string): JsBinding[] => {
  const found: JsBinding[] = [];
  for (const match of masked.matchAll(/(?<![\w$.])import\s*((?:[\w$]+\s*,?\s*)?(?:\*\s*as\s+[\w$]+|\{[^}]*\})?)\s*from\b/g)) {
    const start = match.index ?? 0;
    const source = module_spec(text, start + match[0].length);
    if (!source) continue;
    const clause = match[1] ?? "";
    const entry = (local: string, imported: string) => found.push({ local, imported, module: source.spec, required: false, start, end: source.end });
    const fallback = /^([\w$]+)/.exec(clause)?.[1];
    if (fallback) entry(fallback, "default");
    const namespace = /\*\s*as\s+([\w$]+)/.exec(clause)?.[1];
    if (namespace) entry(namespace, "*");
    for (const item of (/\{([^}]*)\}/.exec(clause)?.[1] ?? "").split(",")) {
      const named = /^\s*([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(item);
      if (named?.[1]) entry(named[2] ?? named[1], named[1]);
    }
  }
  for (const match of masked.matchAll(/(?<![\w$.])(?:const|let|var)\s+([\w$]+|\{[^}]*\})\s*=\s*require\s*\(/g)) {
    const start = match.index ?? 0;
    const source = module_spec(text, start + match[0].length);
    const close = source ? /^\s*\)/.exec(masked.slice(source.end)) : null;
    if (!source || !close) continue;
    const pattern = match[1] ?? "";
    const entry = (local: string, imported: string) => found.push({ local, imported, module: source.spec, required: true, start, end: source.end + close[0].length });
    if (!pattern.startsWith("{")) {
      entry(pattern, "*");
      continue;
    }
    for (const item of pattern.slice(1, -1).split(",")) {
      const named = /^\s*([\w$]+)(?:\s*:\s*([\w$]+))?\s*$/.exec(item);
      if (named?.[1]) entry(named[2] ?? named[1], named[1]);
    }
  }
  return found;
};

const js_used_as = (masked: string, at: number, length: number, use: JsRoot["use"]): boolean => {
  const after = masked.slice(at + length, at + length + 64);
  const before = masked.slice(Math.max(0, at - 16), at);
  if (/[{,]\s*$/.test(before) && /^\s*:/.test(after)) return true;
  if (use === "construct") return /(?<![\w$.])new\s+$/.test(before) && /^\s*\(/.test(after);
  if (use === "member") return /^\s*\??\.\s*(?!(?:win32|posix)(?![\w$])(?!\s*\??\.))[\w$]/.test(after);
  return true;
};

const js_patched = (masked: string, root: string): string[] => {
  const pattern = root.replaceAll(".", String.raw`\s*\.\s*`).replaceAll("$", "\\$");
  const writes = [
    ...masked.matchAll(new RegExp(String.raw`(?<![\w$.])${pattern}${js_chain}\s*${js_assign_op}`, "g")),
    ...masked.matchAll(new RegExp(String.raw`(?:\bdelete|\+\+|--)\s*${pattern}${js_chain}`, "g")),
  ];
  return writes.map((match) => /^\s*\??\.\s*([\w$]+)/.exec(match[1] ?? "")?.[1] ?? "*");
};

const js_root_trusted = (shape: ScriptShape, bindings: JsBinding[], root: string, spec: JsRoot): boolean => {
  const { masked } = shape;
  const full = { start: 0, end: masked.length };
  const own = bindings.filter((entry) => entry.local === root);
  if (own.some((entry) => !spec.modules.includes(entry.module) || !spec.imported.includes(entry.imported))) return false;
  if (!spec.global && !own.length) return false;
  const required = own.filter((entry) => entry.required).length;
  if (required && (name_writes(shape, "require", full, true) > 0 || bindings.some((entry) => entry.local === "require"))) return false;
  if (name_writes(shape, root, full, true) !== required) return false;
  const pattern = new RegExp(String.raw`(?<![\w$.])${root.replaceAll("$", "\\$")}(?![\w$])`, "g");
  return [...masked.matchAll(pattern)].every((match) => {
    const at = match.index ?? 0;
    return own.some((entry) => at >= entry.start && at < entry.end) || js_used_as(masked, at, root.length, spec.use);
  });
};

const js_trust = (shape: ScriptShape, text: string): Set<string> => {
  const { masked } = shape;
  const bindings = js_bindings(text, masked);
  const meta = /(?<![\w$.])import\s*\.\s*meta(?![\w$])/g;
  const meta_trusted = [...masked.matchAll(meta)].every((match) => /^\s*\??\.\s*[\w$]/.test(masked.slice((match.index ?? 0) + match[0].length))) && !js_patched(masked, "import.meta").length;
  const roots = new Map(Object.entries(js_roots).map(([root, spec]) => [root, js_root_trusted(shape, bindings, root, spec)]));
  const moved = /(?<![\w$])chdir\s*\(/.test(masked);
  const process_patches = js_patched(masked, "process");
  return new Set(js_names.filter((name) => {
    if (moved && location_names.has(name)) return false;
    if (name === "cwd") return true;
    if (name.startsWith("import.meta.")) return meta_trusted;
    const [root = "", member] = name.split(".");
    if (!roots.get(root)) return false;
    if (root === "process") return !process_patches.some((patch) => patch === "*" || patch === member);
    return !js_patched(masked, root).length;
  }));
};

export const known_globals = (shape: ScriptShape, text: string): Set<string> => {
  if (dynamic_scope[shape.language].test(shape.masked) || reflective[shape.language].test(shape.masked)) return new Set();
  return shape.language === "python" ? python_trust(shape) : js_trust(shape, text);
};
