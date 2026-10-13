import { hidden_uses, last_start, local_bindings, script_shape, statement_end, type Scope } from "./script-scopes.ts";
import { call_arguments, code_mask } from "./script-text.ts";
import { dynamic_scope, known_globals } from "./script-globals.ts";
import { function_defs, resolve_params } from "./script-params.ts";
import { alternatives_text, quoted_value, script_values, type ValueScope } from "./script-values.ts";

export type SourceLanguage = "python" | "js";

export type Frame = Scope & { parent: number; values: Map<string, string> };

export type Constants = { values: Map<string, string>; packages: Map<string, string>; frames: Frame[]; scope: ValueScope; callers: boolean };

type Span = { start: number; end: number; process: boolean };

export const process_call = /(?<![\w.])(?:subprocess\s*\.\s*(?:run|Popen|call|check_call|check_output)|(?:(?:child_process|require\s*\([^)]*\))\s*\.\s*)?(?:exec|execFile|execSync|execFileSync|spawn|spawnSync)|os\s*\.\s*(?:system|popen))\s*\(/g;

const import_call: Record<SourceLanguage, RegExp> = {
  python: /(?<![\w.])(?:importlib\s*\.\s*import_module|__import__)\s*\(/g,
  js: /(?<![\w.$])(?:import|require)\s*\(/g,
};

const binding: Record<SourceLanguage, RegExp> = {
  python: /^([A-Za-z_]\w*)[ \t]*=(?!=)/dgm,
  js: /^(?:export[ \t]+)?(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*=(?!=)/dgm,
};

const string_literal = /^(?:[rRuUbB]{1,2}(?=["']))?(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|`[^`$\\]*`)/;

export const string_prefix = /(?<![\w$])[rRuUbB]{1,2}(?=["'])/g;

const package_require = /^require\s*\(\s*(["'])([^"'\r\n]+)\1\s*\)/;

const package_import = /^import[ \t]+([A-Za-z_$][\w$]*)[ \t]+from[ \t]*(["'])([^"'\r\n]+)\2/dgm;

const identifier = /(?<![\w$.])[A-Za-z_$][\w$]*(?![\w$])/g;

export const source_language = (file: string): SourceLanguage | null => {
  if (/\.pyw?$/i.test(file)) return "python";
  return /\.(?:[cm]?[jt]sx?)$/i.test(file) ? "js" : null;
};

const package_spec = (spec: string): boolean => !/^(?:\.{1,2}[\\/]|[\\/]|[A-Za-z]:|node:)/.test(spec);

const line_rest = (masked: string, from: number): boolean => /^[ \t;]*(?:\r?\n|$)/.test(masked.slice(from));

const literal_end = (text: string, masked: string, start: number): number | null => {
  const rest = text.slice(start);
  if (/^(?:'''|""")/.test(rest)) return null;
  const opening = rest[0] ?? "";
  if (opening === "[" || opening === "(") {
    const inner = call_arguments(masked, start + 1, opening, opening === "[" ? "]" : ")");
    const end = start + inner.length + 2;
    const valid = /^[\s,]*$/.test(inner) && /["'`]/.test(text.slice(start, end)) && !text.slice(start, end).includes("${");
    return valid && masked[end - 1] === (opening === "[" ? "]" : ")") ? end : null;
  }
  const found = string_literal.exec(rest)?.[0];
  return found ? start + found.length : null;
};

const call_spans = (masked: string, language: SourceLanguage): Span[] =>
  [process_call, import_call[language]].flatMap((pattern) =>
    [...masked.matchAll(pattern)].map((match) => {
      const start = (match.index ?? 0) + match[0].length;
      return { start, end: start + call_arguments(masked, start).length, process: pattern === process_call };
    }));

const first_argument = (masked: string, span: Span, at: number, length: number): boolean =>
  span.process && !masked.slice(span.start, at).trim() && /^\s*(?:,|$)/.test(masked.slice(at + length, span.end));

const call_uses = (masked: string, spans: Span[], name: string, at: number, range: Scope, program: boolean): boolean => {
  const pattern = new RegExp(identifier.source, "g");
  pattern.lastIndex = range.start;
  let used = false;
  for (let match = pattern.exec(masked); match && match.index < range.end; match = pattern.exec(masked)) {
    const index = match.index;
    if (match[0] !== name || index === at) continue;
    used = true;
    const inside = spans.some((span) => index >= span.start && index < span.end && (!program || first_argument(masked, span, index, name.length)));
    if (!inside) return false;
  }
  return used;
};

export const substitute = (text: string, values: Map<string, string>): string => {
  if (!values.size) return text;
  let result = "";
  let last = 0;
  for (const match of code_mask(text).matchAll(identifier)) {
    const value = values.get(match[0]);
    if (value === undefined || match.index === undefined) continue;
    result += text.slice(last, match.index) + value;
    last = match.index + match[0].length;
  }
  return result + text.slice(last);
};

const frames_of = (scopes: Scope[]): Frame[] => {
  const frames: Frame[] = [];
  const open: number[] = [];
  const distinct = [...new Map(scopes.map((entry) => [entry.start, entry])).values()];
  for (const scope of distinct.sort((a, b) => a.start - b.start)) {
    while (open.length && (frames[open.at(-1) ?? -1]?.end ?? 0) <= scope.start) open.pop();
    frames.push({ start: scope.start, end: scope.end, parent: open.at(-1) ?? -1, values: new Map() });
    open.push(frames.length - 1);
  }
  return frames;
};

export const values_at = (constants: Constants, at: number): Map<string, string> => {
  const { frames } = constants;
  let index = last_start(frames, at);
  while (index >= 0 && (frames[index]?.end ?? 0) <= at) index = frames[index]?.parent ?? -1;
  const chain: Map<string, string>[] = [];
  for (let frame = frames[index]; frame; frame = frames[frame.parent]) if (frame.values.size) chain.unshift(frame.values);
  if (!chain.length) return constants.values;
  return new Map([...constants.values, ...chain.flatMap((entries) => [...entries])]);
};

const value_start = (text: string, after: number): number => after + (/^[ \t]*/.exec(text.slice(after))?.[0].length ?? 0);

const binding_value = (text: string, masked: string, clean: string, after: number, scope: ValueScope, known: Map<string, string>): string | null => {
  const start = value_start(text, after);
  const end = statement_end(masked, start, scope.language);
  if (end === null) return null;
  const literal = literal_end(text, masked, start);
  if (literal !== null && !masked.slice(literal, end).trim()) return text.slice(start, literal).replace(string_prefix, "");
  const values = script_values(substitute(clean.slice(start, end), known), scope);
  if (values === null) return null;
  return values.length === 1 ? quoted_value(values[0] ?? "") : alternatives_text(values, scope.language);
};

export const script_constants = (text: string, language: SourceLanguage, file = "", entry = false): Constants => {
  const values = new Map<string, string>();
  const packages = new Map<string, string>();
  const masked = code_mask(text, language);
  const shape = script_shape(masked, language);
  const scope: ValueScope = { file, location: null, language, known: known_globals(shape, text) };
  const constants: Constants = { values, packages, frames: [], scope, callers: false };
  if (dynamic_scope[language].test(masked)) return constants;
  const clean = code_mask(text, language, false);
  const spans = call_spans(masked, language);
  const found = new Map<string, { at: number; value: string; spec: string }[]>();
  const keep = (name: string, at: number, value: string, spec: string) => found.set(name, [...(found.get(name) ?? []), { at, value, spec }]);
  for (const match of masked.matchAll(binding[language])) {
    const name = match[1] ?? "";
    const at = match.indices?.[1]?.[0] ?? -1;
    const after = (match.index ?? 0) + match[0].length;
    const start = value_start(text, after);
    const required = language === "js" ? package_require.exec(text.slice(start)) : null;
    if (required?.[2] && package_spec(required[2]) && line_rest(masked, start + required[0].length)) {
      keep(name, at, "", required[2]);
      continue;
    }
    keep(name, at, binding_value(text, masked, clean, after, scope, new Map()) ?? "", "");
  }
  for (const match of language === "js" ? text.matchAll(package_import) : []) {
    if (masked.startsWith("import", match.index ?? 0) && package_spec(match[3] ?? "")) keep(match[1] ?? "", match.indices?.[1]?.[0] ?? -1, "", match[3] ?? "");
  }
  const calls_only = (name: string, at: number, range: Scope, program: boolean) => hidden_uses(shape, clean, name, range).uses === 0 && call_uses(masked, spans, name, at, range, program);
  const whole = { start: 0, end: masked.length };
  for (const [name, bindings] of found) {
    const only = bindings.length === 1 ? bindings[0] : undefined;
    if (!only || (!only.value && !only.spec) || !calls_only(name, only.at, whole, only.spec !== "")) continue;
    if (only.spec) packages.set(name, only.spec);
    else values.set(name, only.value);
  }
  const kept = (name: string, at: number, range: Scope, value: string) => (/^[[(]/.test(value) ? calls_only(name, at, range, false) : hidden_uses(shape, clean, name, range).writes === 0);
  const locals = local_bindings(shape);
  const functions = entry ? function_defs(shape) : [];
  constants.frames = frames_of([...locals.map((local) => local.scope), ...functions.map((fn) => fn.scope)]);
  const frame_at = new Map(constants.frames.map((frame) => [frame.start, frame]));
  for (const local of locals) {
    const value = binding_value(text, masked, clean, local.value, scope, values_at(constants, local.at));
    if (value === null) continue;
    if (kept(local.name, local.at, local.scope, value)) frame_at.get(local.scope.start)?.values.set(local.name, value);
  }
  if (functions.length) {
    const context = { shape, clean, constants, scope, values_at: (at: number) => values_at(constants, at), substitute, kept };
    constants.callers = resolve_params(context, functions, frame_at);
  }
  return constants;
};
