import path from "node:path";
import { split_statements } from "./statements.ts";

export const source_depth = 4;
export const script_extension = /\.(?:py|pyw|js|mjs|cjs|ts|tsx|jsx|rb|pl|php|lua|r|ps1|psm1|sh|bash|bat|cmd)$/i;
const interpreter_name = /^(?:python(?:\d+(?:\.\d+)*)?|py|node|tsx|ts-node|ruby|perl|php|lua|rscript|bash|sh|powershell|pwsh)(?:\.exe)?$/i;
const package_manager = /^(?:npm|pnpm|yarn)(?:\.cmd)?$/i;
export const shell_source = /\.(?:ps1|psm1|sh|bash|bat|cmd)$/i;
const process_call = /(?<![\w.])(?:subprocess\s*\.\s*(?:run|Popen|call|check_call|check_output)|(?:(?:child_process|require\s*\([^)]*\))\s*\.\s*)?(?:exec|execFile|execSync|execFileSync|spawn|spawnSync)|os\s*\.\s*(?:system|popen))\s*\(/g;
const read_head = /(?:^|[;\n|])\s*(?:get-content|gc|cat|type|select-string|sls|get-filehash|get-childitem|gci|dir|ls|get-item|gi)\b/i;
export const dynamic_path = /[$%\x60*?]|\$\(|\$\{/;
const launcher_name = /^(?:start-process|saps|start)$/i;
const launcher_value_flag = /^-(?:windowstyle|workingdirectory|verb|redirectstandardoutput|redirectstandarderror|redirectstandardinput|credential)$/i;
const runtime_code = /\b(?:iex|invoke-expression)\b|\[scriptblock\]\s*::\s*create\s*\(|\beval\s/i;
const file_read = String.raw`(?:get-content|gc|cat|type)\s+(?:-(?:literalpath|path)\s+)?(["']?)([^\s"'|);]+)\1`;
const executed_read_patterns = [
  new RegExp(String.raw`\b(?:iex|invoke-expression)\b\s*[(\s]*` + file_read, "gi"),
  new RegExp(file_read + String.raw`[^|;\n]*\|\s*(?:iex|invoke-expression)\b`, "gi"),
  new RegExp(String.raw`\[scriptblock\]\s*::\s*create\s*\(\s*\(?\s*` + file_read, "gi"),
  new RegExp(String.raw`\beval\s+["']?\$\(\s*` + file_read, "gi"),
];

export const executed_reads = (text: string): { files: string[]; opaque: boolean } => {
  if (!runtime_code.test(text)) {
    return { files: [], opaque: false };
  }
  const files = new Set<string>();
  for (const pattern of executed_read_patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[2]) {
        files.add(match[2]);
      }
    }
  }
  return { files: [...files], opaque: files.size === 0 };
};

const launched_command = (args: string[]): string[] => {
  let target = "";
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (/^-(?:filepath|file|path)$/i.test(arg)) {
      target = args[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (/^-(?:argumentlist|args)$/i.test(arg)) {
      rest.push(...args.slice(index + 1).filter((entry) => !/^-(?:wait|nonewwindow|passthru)$/i.test(entry)));
      break;
    }
    if (launcher_value_flag.test(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    if (!target) {
      target = arg;
      continue;
    }
    rest.push(arg);
  }
  return target ? [target, ...rest] : [];
};

export const protected_command_read = (command: string): boolean => {
  const target = command.replace(/-pattern\s+("[^"]*"|'[^']*'|\S+)/gi, " ").replace(/\.env\.(?:example|sample)\b/gi, " ");
  return read_head.test(target) && /(?:\.ssh\b|(?:^|[\\/.'"\s])(?:id_rsa|id_ed25519|\.env(?:\b|[.])|\.npmrc|\.pypirc|secrets[.]|credentials[.])|[.](?:pem|key|p12|pfx)\b)/i.test(target);
};

export const words = (text: string): string[] =>
  [...text.matchAll(/"((?:[^"]|"")*)"|'((?:[^']|'')*)'|([^\s"'[\](),;]+)/g)]
    .map(match => match[1] ?? match[2] ?? match[3] ?? "").filter(Boolean);

const code_mask = (text: string): string =>
  text.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\x60(?:\\.|[^\x60\\])*\x60|\/{2}[^\r\n]*|\/\*[\s\S]*?\*\/|#[^\r\n]*/g,
    value => value.replace(/[^\r\n]/g, " "));

const call_arguments = (text: string, start: number, opening = "(", closing = ")"): string => {
  let depth = 1;
  let quote = "";
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") { index += 1; continue; }
      if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === opening) depth += 1;
    if (char === closing) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index);
    }
  }
  return text.slice(start);
};

const literal_command_args = (text: string): boolean => {
  let command = "";
  let tail = text;
  if (text.startsWith("[")) {
    const inner = call_arguments(text, 1, "[", "]");
    command = "[" + inner + "]";
    tail = text.slice(inner.length + 2).trim();
  } else {
    const first = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/.exec(text)?.[0];
    if (!first) return false;
    command = first;
    tail = text.slice(first.length).trim();
    if (tail.startsWith(",")) {
      const next = tail.slice(1).trim();
      if (next.startsWith("[")) {
        const inner = call_arguments(next, 1, "[", "]");
        command += ",[" + inner + "]";
        tail = next.slice(inner.length + 2).trim();
      }
    }
  }
  if (tail && !tail.startsWith(",")) return false;
  return !code_mask(command).replace(/[\s,[\]0-9.+-]/g, "");
};


export type ModuleRef = { kind: "python" | "node"; spec: string };

export type ScriptRefs = { files: string[]; gaps: string[]; payloads: string[]; programs: string[]; entries: string[]; modules: ModuleRef[] };

const runner_value_flag = /^(?:-p|--package|--with|--python|--project|--directory|--from)$/i;

const unwrap_runner = (tokens: string[]): string[] | null => {
  const first = (tokens[0] ?? "").toLowerCase().replace(/\.cmd$/, "");
  const second = (tokens[1] ?? "").toLowerCase();
  const skip = first === "npx" ? 1 : (first === "pnpm" && (second === "exec" || second === "dlx")) || (first === "yarn" && second === "exec") || (first === "uv" && second === "run") ? 2 : 0;
  if (!skip) {
    return null;
  }
  const rest = tokens.slice(skip);
  let index = 0;
  while (index < rest.length && (rest[index] ?? "").startsWith("-")) {
    index += runner_value_flag.test(rest[index] ?? "") ? 2 : 1;
  }
  return rest.slice(index);
};

const module_import = (tokens: string[]): string | null => {
  const name = (tokens[0] ?? "").toLowerCase();
  if (name === "using" && (tokens[1] ?? "").toLowerCase() === "module") {
    return tokens[2] ?? "";
  }
  if (name !== "import-module" && name !== "ipmo") {
    return null;
  }
  const args = tokens.slice(1);
  const named = args.findIndex((arg) => /^-name$/i.test(arg));
  return named >= 0 ? (args[named + 1] ?? "") : (args.find((arg) => !arg.startsWith("-")) ?? "");
};

const glob_only = /^[^$%\x60]*[*?][^$%\x60]*$/;

export const script_refs = (statement: string, shell = true, inline_depth = 0): ScriptRefs => {
  const found: ScriptRefs = { files: [], gaps: [], payloads: [], programs: [], entries: [], modules: [] };
  const commands: string[][] = [];
  if (shell) commands.push(words(statement.trim()));
  const node_process = /child_process/.test(statement);
  for (const match of code_mask(statement).matchAll(process_call)) {
    if (!node_process && /^(?:exec|execFile|execSync|execFileSync|spawn|spawnSync)\s*\($/.test(match[0])) continue;
    const args_text = call_arguments(statement, (match.index ?? 0) + match[0].length).trim();
    if (!literal_command_args(args_text)) {
      found.gaps.push("Dynamic process invocation could not be inspected: " + args_text);
      continue;
    }
    const args = words(args_text);
    const first = args[0] ?? "";
    const command_string = !args_text.startsWith("[") && !/(?:execFile(?:Sync)?|spawn(?:Sync)?)\s*\($/.test(match[0]);
    const command = /\s/.test(first) && command_string
      ? first : args.map(arg => /[\s;&|()]/.test(arg) ? '"' + arg.replaceAll('"', '""') + '"' : arg).join(" ");
    commands.push(...split_statements(command).map(words));
  }
  const nested = (text: string, nested_shell: boolean) => {
    for (const part of nested_shell ? split_statements(text) : [text]) {
      const refs = script_refs(part, nested_shell, inline_depth + 1);
      for (const key of ["files", "gaps", "payloads", "programs", "entries"] as const) found[key].push(...refs[key]);
      found.modules.push(...refs.modules);
    }
  };
  for (const tokens of commands) {
    const unwrapped = unwrap_runner(tokens);
    if (unwrapped) {
      if (unwrapped.length) commands.push(unwrapped);
      continue;
    }
    const module_path = module_import(tokens);
    if (module_path !== null) {
      if (script_extension.test(module_path)) found.files.push(module_path);
      else if (/[\\/]/.test(module_path) || dynamic_path.test(module_path)) found.gaps.push("Module import could not be inspected: " + module_path);
      continue;
    }
    const launch = /^(?:&|\.)$/.test(tokens[0] ?? "") || /^(?:call|source)$/i.test(tokens[0] ?? "");
    const head = launch ? 1 : 0;
    const direct = tokens[head] ?? "";
    const name = path.basename(direct);
    if (script_extension.test(direct) && !package_manager.test(direct)) found.files.push(direct);
    else if (launch && dynamic_path.test(direct)) found.gaps.push("Dynamic script invocation: " + direct);
    else if (/[\\/]/.test(direct) && !dynamic_path.test(direct) && !interpreter_name.test(name) && !package_manager.test(name)) found.programs.push(direct);
    const args = tokens.slice(head + 1);
    if (launcher_name.test(name)) {
      const launched = launched_command(args);
      if (launched.length) commands.push(launched);
      if (args.some((arg) => /^-workingdirectory$/i.test(arg))) found.gaps.push("Start-Process working directory could not be resolved: " + statement.trim());
    }
    if (/^cmd(?:\.exe)?$/i.test(name) && /^\/[ck]$/i.test(args[0] ?? "")) {
      const payload = args.slice(1).join(" ");
      if (!payload || /^[$%]/.test(payload)) found.gaps.push("Dynamic shell payload could not be inspected: " + payload);
      else if (inline_depth >= source_depth) found.gaps.push("Inline source inspection depth exceeded (" + source_depth + ").");
      else nested(payload, true);
    }
    if (!interpreter_name.test(name)) continue;
    let file = "";
    let inline = false;
    const powershell = /^(?:powershell|pwsh)(?:\.exe)?$/i.test(name);
    const python = /^(?:python|py)/i.test(name);
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index] ?? "";
      if (/^(?:-c|-e|--eval|-command|-encodedcommand|-enc|-ec)$/i.test(arg)) {
        const payload = args[index + 1] ?? "";
        if (!payload || /^[$%]/.test(payload)) found.gaps.push("Dynamic or missing interpreter payload could not be inspected.");
        else if (inline_depth >= source_depth) found.gaps.push("Inline source inspection depth exceeded (" + source_depth + ").");
        else {
          const encoded = powershell && /^-(?:encodedcommand|enc|ec)$/i.test(arg);
          const body = encoded ? Buffer.from(payload, "base64").toString("utf16le") : payload;
          if (encoded) found.payloads.push(body);
          nested(body, powershell || /^(?:bash|sh)$/i.test(name));
        }
        inline = true;
        break;
      }
      if (python && arg === "-m") {
        found.modules.push({ kind: "python", spec: args[index + 1] ?? "" });
        inline = true;
        break;
      }
      if (!python && /^(?:--require|-r|--import)$/i.test(arg)) {
        found.modules.push({ kind: "node", spec: args[index + 1] ?? "" });
        index += 1;
        continue;
      }
      if (powershell && /^-file$/i.test(arg)) {
        file = args[index + 1] ?? "";
        if (!file) found.gaps.push("Script interpreter has no file argument.");
        break;
      }
      if (powershell && /^-(?:executionpolicy|windowstyle)$/i.test(arg)) { index += 1; continue; }
      if (arg.startsWith("-")) continue;
      file = arg;
      break;
    }
    if (inline || !file) continue;
    if (glob_only.test(file)) found.entries.push(file);
    else if (script_extension.test(file)) found.files.push(file);
    else if (!dynamic_path.test(file)) found.entries.push(file);
    else found.gaps.push("Unresolved interpreter script: " + file);
  }
  return { ...found, files: [...new Set(found.files)], entries: [...new Set(found.entries)] };
};
