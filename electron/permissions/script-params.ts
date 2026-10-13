import type { Constants, Frame, SourceLanguage } from "./script-constants.ts";
import { hidden_uses, name_writes, python_free_functions, statement_end, write_at, type Scope, type ScriptShape } from "./script-scopes.ts";
import { call_arguments, top_level } from "./script-text.ts";
import { alternatives_text, quoted_value, script_values, type ValueScope } from "./script-values.ts";

export type FunctionDef = { name: string; at: number; params: ({ name: string; at: number } | null)[]; scope: Scope };

type Site = { at: number; args: string[] };

export type ParamContext = {
  shape: ScriptShape;
  clean: string;
  constants: Constants;
  scope: ValueScope;
  values_at: (at: number) => Map<string, string>;
  substitute: (text: string, values: Map<string, string>) => string;
  kept: (name: string, at: number, range: Scope, value: string) => boolean;
};

export const main_reach = /(?<![\w.])__main__(?!\w)|(?<![\w.])sys\s*\.\s*modules\b|\bf_(?:globals|locals|back)\b|__globals__|get_referrers|(?<![\w.])__name__\s*[),]/;

const parameters = (masked: string, open: number, close: number, language: SourceLanguage): FunctionDef["params"] => {
  const found: FunctionDef["params"] = [];
  let offset = open + 1;
  for (const part of top_level(masked.slice(open + 1, close), ",")) {
    const at = offset + (/^\s*/.exec(part)?.[0].length ?? 0);
    offset += part.length + 1;
    const text = part.trim();
    if (!text || (language === "python" && text === "/")) continue;
    if (/^(?:\*|\.\.\.)/.test(text)) break;
    const name = /^([A-Za-z_$][\w$]*)\s*(?:[:=][\s\S]*)?$/.exec(text)?.[1];
    found.push(name ? { name, at } : null);
  }
  return found;
};

const decorated = (masked: string, start: number): boolean => {
  let end = start - 1;
  while (end >= 0 && /\s/.test(masked[end] ?? "")) end -= 1;
  return masked.slice(masked.lastIndexOf("\n", end) + 1, end + 1).trim().startsWith("@");
};

const python_defs = (shape: ScriptShape): FunctionDef[] => {
  const { masked, pairs } = shape;
  const blocks = new Map(python_free_functions(masked).map((block) => [block.start, block]));
  return [...masked.matchAll(/^[ \t]*(?:async[ \t]+)?def[ \t]+([A-Za-z_]\w*)[ \t]*\(/dgm)].flatMap((match) => {
    const start = match.index ?? 0;
    const block = blocks.get(start);
    const open = start + match[0].length - 1;
    const close = pairs.get(open);
    if (!block || close === undefined || decorated(masked, start)) return [];
    const name = match[1] ?? "";
    return [{ name, at: match.indices?.[1]?.[0] ?? -1, params: parameters(masked, open, close, "python"), scope: block }];
  });
};

const js_body_end = (shape: ScriptShape, from: number): number | null => {
  const { masked, pairs } = shape;
  const brace = from + (/^\s*/.exec(masked.slice(from))?.[0].length ?? 0);
  if (masked[brace] === "{") return (pairs.get(brace) ?? masked.length - 1) + 1;
  return statement_end(masked, brace, "js");
};

const js_defs = (shape: ScriptShape): FunctionDef[] => {
  const { masked, pairs } = shape;
  const forms = [
    /(?<![\w$.])(export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/dg,
    /(?<![\w$.])(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\s*\*?\s*[\w$]*\s*)?\(/dg,
  ];
  return forms.flatMap((form) => [...masked.matchAll(form)].flatMap((match) => {
    const start = match.index ?? 0;
    const open = start + match[0].length - 1;
    const close = pairs.get(open);
    if (match[1] || close === undefined) return [];
    const declared = /function\s*\*?\s*[\w$]*\s*\($/.test(match[0]);
    const arrow = /^\s*=>/.exec(masked.slice(close + 1));
    if (!declared && !arrow) return [];
    const end = js_body_end(shape, close + 1 + (arrow?.[0].length ?? 0));
    const name = match[2] ?? "";
    if (end === null) return [];
    return [{ name, at: match.indices?.[2]?.[0] ?? -1, params: parameters(masked, open, close, "js"), scope: { start, end } }];
  }));
};

type Occurrence = { at: number; member: boolean; global: boolean };

const occurrences = (clean: string, names: Set<string>, language: SourceLanguage): Map<string, Occurrence[]> => {
  const found = new Map<string, Occurrence[]>();
  for (const match of clean.matchAll(/(?<![\w$])[A-Za-z_$][\w$]*/g)) {
    if (!names.has(match[0])) continue;
    const at = match.index ?? 0;
    const before = clean.slice(Math.max(0, at - 24), at);
    const list = found.get(match[0]) ?? [];
    list.push({ at, member: /(?<!\.)\.\s*$/.test(before), global: language === "js" && /(?<![\w$.])(?:this|globalThis|global|window|self)\s*(?:\?\.|\.)\s*$/.test(before) });
    found.set(match[0], list);
  }
  return found;
};

const call_sites = (context: ParamContext, fn: FunctionDef, seen: Occurrence[]): Site[] | null => {
  const { shape, clean } = context;
  if (seen.some((entry) => entry.global)) return null;
  const own = seen.filter((entry) => !entry.member);
  if (own.filter((entry) => shape.masked.startsWith(fn.name, entry.at) && write_at(shape, entry.at, fn.name)).length !== 1) return null;
  const sites: Site[] = [];
  for (const { at } of own) {
    if (at === fn.at) continue;
    const open = /^\s*\(/.exec(clean.slice(at + fn.name.length, at + fn.name.length + 64));
    if (!open) return null;
    const inner = call_arguments(clean, at + fn.name.length + open[0].length);
    sites.push({ at, args: top_level(inner, ",", shape.language).map((arg) => arg.trim()).filter(Boolean) });
  }
  return sites.length ? sites : null;
};

const positional = (args: string[]): string[] | null => {
  if (args.some((arg) => /^(?:\*|\.\.\.)/.test(arg))) return null;
  const keyword = args.findIndex((arg) => /^[A-Za-z_]\w*\s*=(?!=)/.test(arg));
  return keyword < 0 ? args : args.slice(0, keyword);
};

const param_value = (context: ParamContext, sites: Site[], index: number): string | null => {
  const found = new Set<string>();
  for (const site of sites) {
    const arg = positional(site.args)?.[index];
    if (arg === undefined) return null;
    const values = script_values(context.substitute(arg, context.values_at(site.at)), context.scope);
    if (values === null) return null;
    values.forEach((value) => found.add(value));
  }
  const values = [...found];
  if (!values.length || values.length > 8) return null;
  return values.length === 1 ? quoted_value(values[0] ?? "") : alternatives_text(values, context.scope.language);
};

export const function_defs = (shape: ScriptShape): FunctionDef[] => {
  if (shape.language === "python" && main_reach.test(shape.masked)) return [];
  return shape.language === "python" ? python_defs(shape) : js_defs(shape);
};

export const resolve_params = (context: ParamContext, functions: FunctionDef[], frames: Map<number, Frame>): boolean => {
  const { shape, clean } = context;
  const seen = occurrences(clean, new Set(functions.map((fn) => fn.name)), shape.language);
  const sites = new Map(functions.map((fn) => [fn, call_sites(context, fn, seen.get(fn.name) ?? [])]));
  let resolved = false;
  for (let pass = 0; pass <= functions.length && pass < 8; pass += 1) {
    let changed = false;
    for (const fn of functions) {
      const calls = sites.get(fn);
      const frame = frames.get(fn.scope.start);
      const mapped = shape.language === "js" && /(?<![\w$.])arguments(?![\w$])/.test(shape.masked.slice(fn.scope.start, fn.scope.end));
      if (!calls || !frame || mapped) continue;
      for (const [index, param] of fn.params.entries()) {
        if (!param || frame.values.has(param.name)) continue;
        if (name_writes(shape, param.name, fn.scope) !== 1 || hidden_uses(shape, clean, param.name, fn.scope).writes > 0) continue;
        const value = param_value(context, calls, index);
        if (value === null || !context.kept(param.name, param.at, fn.scope, value)) continue;
        frame.values.set(param.name, value);
        changed = true;
        resolved = true;
      }
    }
    if (!changed) break;
  }
  return resolved;
};
