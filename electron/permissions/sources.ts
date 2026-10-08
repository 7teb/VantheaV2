import fs from "node:fs/promises";
import path from "node:path";
import { is_secret_path, is_inside, project_real_root } from "../project/scope.ts";
import { error_code, error_text } from "../storage/coerce.ts";
import { decode_text } from "../storage/text-codec.ts";
import { permission_hash } from "./context.ts";
import { floor_reason } from "./floor.ts";
import { split_pipelines, split_statements } from "./statements.ts";

export type CommandSources = { text: string; hash: string; complete: boolean; protected_read: boolean; gaps: string[]; catastrophic: string[] };
export const source_chars = 24000;
const source_bytes = 96000;
const source_files = 32;
const source_depth = 4;
const script_extension = /\.(?:py|pyw|js|mjs|cjs|ts|tsx|jsx|rb|pl|php|lua|r|ps1|psm1|sh|bash|bat|cmd)$/i;
const interpreter_name = /^(?:python(?:\d+(?:\.\d+)*)?|py|node|ruby|perl|php|lua|rscript|bash|sh|powershell|pwsh)(?:\.exe)?$/i;
const package_manager = /^(?:npm|pnpm|yarn)(?:\.cmd)?$/i;
const shell_source = /\.(?:ps1|psm1|sh|bash|bat|cmd)$/i;
const process_call = /(?<![\w.])(?:subprocess\s*\.\s*(?:run|Popen|call|check_call|check_output)|(?:(?:child_process|require\s*\([^)]*\))\s*\.\s*)?(?:exec|execFile|execSync|execFileSync|spawn|spawnSync)|os\s*\.\s*(?:system|popen))\s*\(/g;
const read_head = /(?:^|[;\n|])\s*(?:get-content|gc|cat|type|select-string|sls|get-filehash|get-childitem|gci|dir|ls|get-item|gi)\b/i;
const dynamic_path = /[$%\x60*?]|\$\(|\$\{/;
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

const executed_reads = (text: string): { files: string[]; opaque: boolean } => {
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

const words = (text: string): string[] =>
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

const script_refs = (statement: string, shell = true, inline_depth = 0): { files: string[]; gaps: string[] } => {
  const files: string[] = [];
  const gaps: string[] = [];
  const commands: string[][] = [];
  if (shell) commands.push(words(statement.trim()));
  const node_process = /child_process/.test(statement);
  for (const match of code_mask(statement).matchAll(process_call)) {
    if (!node_process && /^(?:exec|execFile|execSync|execFileSync|spawn|spawnSync)\s*\($/.test(match[0])) continue;
    const args_text = call_arguments(statement, (match.index ?? 0) + match[0].length).trim();
    if (!literal_command_args(args_text)) {
      gaps.push("Dynamic process invocation could not be inspected: " + args_text);
      continue;
    }
    const args = words(args_text);
    const first = args[0] ?? "";
    const command_string = !args_text.startsWith("[") && !/(?:execFile(?:Sync)?|spawn(?:Sync)?)\s*\($/.test(match[0]);
    const command = /\s/.test(first) && command_string
      ? first : args.map(arg => /[\s;&|()]/.test(arg) ? '"' + arg.replaceAll('"', '""') + '"' : arg).join(" ");
    commands.push(...split_statements(command).map(words));
  }
  for (const tokens of commands) {
    const launch = /^(?:&|\.)$/.test(tokens[0] ?? "") || /^(?:call|source)$/i.test(tokens[0] ?? "");
    const head = launch ? 1 : 0;
    const direct = tokens[head] ?? "";
    const name = path.basename(direct);
    if (script_extension.test(direct) && !package_manager.test(direct)) files.push(direct);
    else if (launch && dynamic_path.test(direct)) gaps.push("Dynamic script invocation: " + direct);
    const args = tokens.slice(head + 1);
    if (launcher_name.test(name)) {
      const launched = launched_command(args);
      if (launched.length) commands.push(launched);
      if (args.some((arg) => /^-workingdirectory$/i.test(arg))) gaps.push("Start-Process working directory could not be resolved: " + statement.trim());
    }
    if (/^cmd(?:\.exe)?$/i.test(name) && /^\/[ck]$/i.test(args[0] ?? "")) {
      const payload = args.slice(1).join(" ");
      if (!payload || /^[$%]/.test(payload)) gaps.push("Dynamic shell payload could not be inspected: " + payload);
      else if (inline_depth >= source_depth) gaps.push("Inline source inspection depth exceeded (" + source_depth + ").");
      else {
        for (const part of split_statements(payload)) {
          const refs = script_refs(part, true, inline_depth + 1);
          files.push(...refs.files);
          gaps.push(...refs.gaps);
        }
      }
    }
    if (!interpreter_name.test(name)) continue;
    let file = "";
    let inline = false;
    const powershell = /^(?:powershell|pwsh)(?:\.exe)?$/i.test(name);
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (/^(?:-c|-e|--eval|-command|-encodedcommand|-enc|-ec)$/i.test(arg)) {
        const payload = args[index + 1] ?? "";
        if (!payload || /^[$%]/.test(payload)) gaps.push("Dynamic or missing interpreter payload could not be inspected.");
        else if (inline_depth >= source_depth) gaps.push("Inline source inspection depth exceeded (" + source_depth + ").");
        else {
          const encoded = powershell && /^-(?:encodedcommand|enc|ec)$/i.test(arg);
          const body = encoded ? Buffer.from(payload, "base64").toString("utf16le") : payload;
          const inline_shell = powershell || /^(?:bash|sh)$/i.test(name);
          for (const part of inline_shell ? split_statements(body) : [body]) {
            const refs = script_refs(part, inline_shell, inline_depth + 1);
            files.push(...refs.files);
            gaps.push(...refs.gaps);
          }
        }
        inline = true;
        break;
      }
      if (/^(?:-m|--require|-r|--import)$/i.test(arg)) {
        gaps.push("Interpreter module or preload dependency could not be inspected: " + (args[index + 1] ?? arg));
        break;
      }
      if (powershell && /^-file$/i.test(arg)) {
        file = args[index + 1] ?? "";
        if (!file) gaps.push("Script interpreter has no file argument.");
        break;
      }
      if (powershell && /^-(?:executionpolicy|windowstyle)$/i.test(arg)) { index += 1; continue; }
      if (arg.startsWith("-")) continue;
      file = arg;
      break;
    }
    if (inline || !file) continue;
    if (script_extension.test(file)) files.push(file);
    else if (dynamic_path.test(file)) gaps.push("Unresolved interpreter script: " + file);
    else gaps.push("Interpreter entry source could not be resolved: " + file);
  }
  return { files: [...new Set(files)], gaps };
};

const bounded_text = async (file: string): Promise<{ text: string; complete: boolean; hash: string }> => {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(source_bytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead === buffer.length) {
      const stat = await handle.stat({ bigint: true });
      const stamp = stat.size.toString() + ":" + stat.mtimeNs.toString() + ":" + stat.ctimeNs.toString();
      return { text: "", complete: false, hash: permission_hash(stamp + ":" + buffer.toString("base64")) };
    }
    const bytes = buffer.subarray(0, bytesRead);
    const { text } = decode_text(bytes);
    return { text: text.length <= source_chars ? text : "", complete: text.length <= source_chars, hash: permission_hash(bytes.toString("base64")) };
  } finally {
    await handle.close();
  }
};

export const inspect_command_sources = async (project_root: string, cwd: string, command: string): Promise<CommandSources> => {
  const fingerprints = ["environment:" + permission_hash(JSON.stringify(process.env))];
  const contents: string[] = [];
  const gaps: string[] = [];
  const seen = new Map<string, string>();
  const inspected = new Set<string>();
  const packages = new Set<string>();
  const active_packages = new Set<string>();
  let total = 0;
  let root = "";
  const gap = (reason: string) => {
    if (!gaps.includes(reason)) gaps.push(reason);
    fingerprints.push("gap:" + reason);
  };
  if (project_root) {
    try { root = await project_real_root(project_root); }
    catch (error) { gap("Project inspection failed: " + error_text(error)); }
  }
  const add = async (file: string, required: boolean): Promise<string> => {
    const target = path.resolve(file);
    if (seen.has(target)) return seen.get(target) ?? "";
    if (!root || !is_inside(root, target) || is_secret_path(target)) {
      if (required) gap("Source is outside the project or protected: " + target);
      return "";
    }
    if (seen.size >= source_files) {
      gap("Source file limit exceeded (" + source_files + "): " + target);
      return "";
    }
    try {
      const real = await fs.realpath(target);
      if (!is_inside(root, real) || is_secret_path(real)) {
        gap("Source links outside the project or to a protected file: " + target);
        return "";
      }
      seen.set(target, "");
      const source = await bounded_text(real);
      fingerprints.push(real + ":" + source.hash);
      if (!source.complete) { gap("Source file exceeds inspection limit: " + target); return ""; }
      if (total + source.text.length > source_chars) {
        gap("Combined source text exceeds inspection limit (" + source_chars + " characters).");
        return "";
      }
      total += source.text.length;
      seen.set(target, source.text);
      contents.push(real + "\n" + source.text);
      return source.text;
    } catch (error) {
      if (required || error_code(error) !== "ENOENT") {
        gap("Source is unavailable: " + target + " (" + error_code(error) + ")");
      }
      return "";
    }
  };
  if (root) {
    const doc = await add(path.join(root, "AGENTS.md"), false);
    if (!doc) await add(path.join(root, "CLAUDE.md"), false);
  }
  const catastrophic: string[] = [];
  const follow = async (file: string, depth: number, location: string, known_location: boolean, shell: boolean): Promise<void> => {
    if (dynamic_path.test(file) || !known_location) {
      gap("Script path or its working directory could not be resolved: " + file);
      return;
    }
    if (depth >= source_depth) {
      gap("Script inspection depth exceeded (" + source_depth + "): " + file);
      return;
    }
    const target = path.resolve(location, file);
    const key = target + "\n" + location;
    if (inspected.has(key)) return;
    inspected.add(key);
    const body = await add(target, true);
    if (body) await inspect(body, depth + 1, location, shell, target);
  };
  const inspect = async (text: string, depth: number, cwd_location: string, shell = true, origin = ""): Promise<void> => {
    let location = cwd_location;
    let known_location = true;
    if (shell && origin) {
      const hit = floor_reason(text);
      if (hit && !catastrophic.includes(origin + ": " + hit)) catastrophic.push(origin + ": " + hit);
    }
    if (shell) {
      for (const pipeline of split_pipelines(text)) {
        const executed = executed_reads(pipeline);
        if (executed.opaque) gap("Code that is built or downloaded at runtime gets executed and could not be inspected: " + pipeline.trim().slice(0, 200));
        for (const file of executed.files) await follow(file, depth, cwd_location, true, true);
      }
    }
    for (const statement of shell ? split_statements(text) : [text]) {
      const tokens = words(statement);
      if (shell && /^(?:cd|chdir|sl|set-location|push-location)$/i.test(tokens[0] ?? "")) {
        const target = tokens[1] ?? "";
        if (!target || tokens.length !== 2 || dynamic_path.test(target) || /^[-/]/.test(target)) {
          known_location = false;
          gap("Working directory change could not be resolved: " + statement);
        } else {
          location = path.resolve(location, target);
        }
      }
      if (shell && /^(?:pop-location|popd)$/i.test(tokens[0] ?? "")) {
        known_location = false;
        gap("Working directory restore could not be resolved: " + statement);
      }
      const refs = script_refs(statement, shell);
      refs.gaps.forEach(gap);
      for (const file of refs.files) {
        await follow(file, depth, location, known_location, shell_source.test(file));
      }
      const package_call = /^(?:npm|pnpm|yarn)(?:\.cmd)?\s+(?:run\s+)?(test|build|start|[\w:-]+)/i.exec(statement.trim());
      if (!shell || !package_call || !/^(?:npm|pnpm|yarn)(?:\.cmd)?\s+(?:run|test|build|start)\b/i.test(statement.trim())) continue;
      if (!known_location) { gap("Package script working directory could not be resolved."); continue; }
      const manifest_path = path.join(location, "package.json");
      const manifest = await add(manifest_path, true);
      if (!manifest) continue;
      try {
        const parsed = JSON.parse(manifest) as { scripts?: Record<string, string> };
        const name = package_call[1];
        const key = manifest_path + ":" + name;
        const script = parsed.scripts?.[name];
        if (typeof script !== "string") { gap("Package script is missing: " + name); continue; }
        if (active_packages.has(key) || depth >= source_depth) { gap("Package script recursion limit reached: " + key); continue; }
        if (packages.has(key)) continue;
        packages.add(key);
        active_packages.add(key);
        try {
          const lifecycle = /(?:^|\s)--ignore-scripts(?:\s|$)/i.test(statement) ? [name] : ["pre" + name, name, "post" + name];
          for (const entry of lifecycle) {
            const body = parsed.scripts?.[entry];
            if (typeof body === "string") await inspect(body, depth + 1, location);
          }
        }
        finally { active_packages.delete(key); }
      } catch (error) {
        gap("Package script inspection failed: " + error_text(error));
      }
    }
  };
  await inspect(command, 0, cwd || root);
  const text = contents.join("\n\n") + (gaps.length ? "\n\nINSPECTION GAPS\n" + gaps.join("\n") : "");
  return { text, hash: permission_hash(fingerprints.join("\n")), complete: gaps.length === 0, protected_read: protected_command_read(command), gaps, catastrophic };
};
