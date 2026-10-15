import { process_call, script_constants, substitute, values_at, type SourceLanguage } from "./script-constants.ts";
import { call_arguments, code_mask, top_level } from "./script-text.ts";
import { script_values } from "./script-values.ts";
import type { Dialect } from "./statements.ts";

export const script_extension = /\.(?:py|pyw|js|mjs|cjs|ts|tsx|jsx|rb|pl|php|lua|r|ps1|psm1|sh|bash|bat|cmd)$/i;
export const shell_source = /\.(?:ps1|psm1|sh|bash|bat|cmd)$/i;
export const dynamic_path = /[$%\x60*?]|\$\(|\$\{/;
const runtime_code = /\b(?:iex|invoke-expression)\b|\[scriptblock\]\s*::\s*create\s*\(|\beval\s/i;
const file_read = String.raw`(?:get-content|gc|cat|type)\s+(?:-(?:literalpath|path)\s+)?(["']?)([^\s"'|);]+)\1`;
const executed_read_patterns = [
  new RegExp(String.raw`\b(?:iex|invoke-expression)\b\s*[(\s]*` + file_read, "gi"),
  new RegExp(file_read + String.raw`[^|;\n]*\|\s*(?:iex|invoke-expression)\b`, "gi"),
  new RegExp(String.raw`\[scriptblock\]\s*::\s*create\s*\(\s*\(?\s*` + file_read, "gi"),
  new RegExp(String.raw`\beval\s+["']?\$\(\s*` + file_read, "gi"),
];

export type ExecutedRead = { file: string; dialect: Dialect };

export type ModuleRef = { kind: "python" | "node"; spec: string };

export const runtime_text = (text: string): boolean => runtime_code.test(text);

export const script_dialect = (file: string): Dialect | null => {
  if (/\.psm?1$/i.test(file)) return "powershell";
  if (/\.(?:bat|cmd)$/i.test(file)) return "cmd";
  return /\.(?:sh|bash)$/i.test(file) ? "posix" : null;
};

export const executed_reads = (text: string): { files: ExecutedRead[]; opaque: boolean } => {
  if (!runtime_code.test(text)) {
    return { files: [], opaque: false };
  }
  const files = new Map<string, ExecutedRead>();
  for (const [index, pattern] of executed_read_patterns.entries()) {
    for (const match of text.matchAll(pattern)) {
      if (match[2] && !files.has(match[2])) files.set(match[2], { file: match[2], dialect: index === 3 ? "posix" : "powershell" });
    }
  }
  return { files: [...files.values()], opaque: files.size === 0 };
};

export const quote_arg = (arg: string): string => (/[\s;&|()]/.test(arg) ? '"' + arg.replaceAll('"', '""') + '"' : arg);

const interpreter_program = /^(?:python[\d.]*w?|py|node|cmd|powershell|pwsh|bash|sh|ruby|perl|php)$/;

const value_switch = /^(?:-c|-m|-e|--eval|-p|--print|-r|--require|--import|--loader|--experimental-loader|\/c|\/k|\/r|-command|-file|-f|-encodedcommand|-enc|-ec)$/i;

const unknown_argument = "!argument!";

const element_value = (text: string): string | null => {
  const match = /^\s*(?:[rRuUbB]{1,2})?(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')\s*$/.exec(text) ?? /^\s*`([^`$\\]*)`\s*$/.exec(text);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
};

type Candidates = string[] | null;

type ElementValue = (text: string) => Candidates;

export const syntax_check = (program: string, flag: string): boolean => program === "node" && (flag === "--check" || flag === "-c");

const list_elements = (text: string, language: SourceLanguage | null, value_of: ElementValue): Candidates[] | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  return top_level(trimmed.slice(1, -1), ",", language).filter((entry) => entry.trim()).map(value_of);
};

const required_elements = (argv: (string | null)[]): number => {
  const program = (argv[0]?.split(/[\\/]/).pop() ?? "").toLowerCase().replace(/\.exe$/, "");
  if (!interpreter_program.test(program)) return 1;
  let parse_only = false;
  for (let index = 1; index < argv.length; index += 1) {
    const entry = argv[index];
    if (entry === null || entry === undefined) return parse_only && index === argv.length - 1 ? index : index + 1;
    if (syntax_check(program, entry)) {
      parse_only = true;
      continue;
    }
    if (value_switch.test(entry)) return index + 2;
    if (!/^[-/]/.test(entry)) return index + 1;
  }
  return argv.length;
};

const call_argv = (args_text: string, string_call: boolean, language: SourceLanguage | null, value_of: ElementValue): { argv: Candidates[]; line: boolean } | null => {
  const [first = "", second] = top_level(args_text, ",", language).map((entry) => entry.trim());
  const listed = list_elements(first, language, value_of);
  if (listed) return { argv: listed, line: false };
  const program = value_of(first);
  if (program === null) return null;
  if (!string_call) return { argv: [program, ...(second === undefined ? [] : (list_elements(second, language, value_of) ?? [null]))], line: false };
  return { argv: [program], line: true };
};

const combinations = (argv: Candidates[]): (string | null)[][] | null => {
  let found: (string | null)[][] = [[]];
  for (const entry of argv) {
    found = found.flatMap((combination) => (entry ?? [null]).map((value) => [...combination, value]));
    if (found.length > 8) return null;
  }
  return found;
};

const command_line = (argv: (string | null)[], line: boolean): string => {
  const [program = ""] = argv;
  if (line && program !== null && /\s/.test(program)) return program;
  return argv.map((entry) => (entry === null ? unknown_argument : quote_arg(entry))).join(" ");
};

export type PackageProgram = { written: string; spec: string; line: number };

export const process_refs = (text: string, language: SourceLanguage | null, file = "", entry = false): { commands: string[]; gaps: string[]; packages: PackageProgram[]; callers: boolean } => {
  const commands: string[] = [];
  const gaps: string[] = [];
  const packages: PackageProgram[] = [];
  const node_process = /child_process/.test(text);
  const calls = [...code_mask(text, language).matchAll(process_call)];
  const constants = language && calls.length ? script_constants(text, language, file, entry) : null;
  const value_of = (element: string): Candidates => {
    const literal = element_value(element);
    if (literal !== null) return [literal];
    return constants ? script_values(element, constants.scope) : null;
  };
  for (const match of calls) {
    if (!node_process && /^(?:exec|execFile|execSync|execFileSync|spawn|spawnSync)\s*\($/.test(match[0])) continue;
    const start = (match.index ?? 0) + match[0].length;
    const written = call_arguments(text, start).trim();
    const head = /^[A-Za-z_$][\w$]*/.exec(written)?.[0] ?? "";
    const spec = constants?.packages.get(head);
    if (spec) {
      packages.push({ written: head, spec, line: text.slice(0, start).split("\n").length });
      continue;
    }
    const args_text = constants ? substitute(written, values_at(constants, start)) : written;
    const shell = /\bshell\s*(?:=\s*True|:\s*true)\b/.test(args_text);
    const string_call = !/(?:execFile(?:Sync)?|spawn(?:Sync)?)\s*\($/.test(match[0]);
    const found = call_argv(args_text, string_call, language, value_of);
    const each = found ? combinations(found.argv) : null;
    if (!found || !each || each.some((argv) => argv.slice(0, shell ? argv.length : required_elements(argv)).some((entry) => entry === null))) {
      gaps.push("Dynamic process invocation could not be inspected: " + written);
      continue;
    }
    commands.push(...each.map((argv) => command_line(argv, found.line)));
  }
  return { commands, gaps, packages, callers: constants?.callers === true };
};
