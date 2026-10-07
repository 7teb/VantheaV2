import fs from "node:fs/promises";
import path from "node:path";
import { is_secret_path, is_inside, project_real_root } from "../project/scope.ts";
import { error_code, error_text } from "../storage/coerce.ts";
import { split_statements } from "./statements.ts";
import { permission_hash } from "./context.ts";

export type CommandSources = { text: string; hash: string; complete: boolean; protected_read: boolean };
export const source_chars = 24000;

const script_pattern = /(?:^|\s)(?:python(?:\d+(?:\.\d+)*)?(?:\.exe)?|py(?:\.exe)?|node(?:\.exe)?|ruby|perl|php|lua|rscript)\s+(?:-[\w-]+\s+)*["']?([^"'\s]+\.(?:py|pyw|js|mjs|cjs|ts|tsx|jsx|rb|pl|php|lua|r))["']?/ig;
const direct_script = /^(?:&\s*)?["']?([^"'\s]+\.(?:ps1|psm1|sh|bash))["']?(?:\s|$)/i;
const powershell_file = /(?:^|\s)(?:powershell|pwsh)(?:\.exe)?\s+.*?-file\s+["']?([^"'\s]+)["']?/i;
const directory_change = /^(?:cd|chdir|sl|set-location|push-location)\s+["']?([^"']+?)["']?$/i;
const read_head = /(?:^|[;\n|])\s*(?:get-content|gc|cat|type|select-string|sls|get-filehash|get-childitem|gci|dir|ls|get-item|gi)\b/i;

export const protected_command_read = (command: string): boolean =>
  read_head.test(command) && /(?:\.ssh\b|(?:^|[\\/.'"\s])(?:id_rsa|id_ed25519|\.env(?:\b|[.])|\.npmrc|\.pypirc|secrets[.]|credentials[.])|[.](?:pem|key|p12|pfx)\b)/i.test(command);

const bounded_text = async (file: string): Promise<{ text: string; complete: boolean; hash: string }> => {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(source_chars * 4 + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead === buffer.length) return { text: "", complete: false, hash: "over-limit" };
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    return { text: text.length <= source_chars ? text : "", complete: text.length <= source_chars, hash: permission_hash(text) };
  } finally {
    await handle.close();
  }
};

export const inspect_command_sources = async (project_root: string, cwd: string, command: string): Promise<CommandSources> => {
  const fingerprints: string[] = ["environment:" + permission_hash(JSON.stringify(process.env))];
  const contents: string[] = [];
  let complete = true;
  let total = 0;
  const seen = new Set<string>();
  let root = "";
  if (project_root) {
    try { root = await project_real_root(project_root); }
    catch (error) { complete = false; console.warn("[permissions] project inspection failed: " + error_text(error)); }
  }
  const add = async (file: string, required: boolean): Promise<string> => {
    const target = path.resolve(file);
    if (seen.has(target)) return "";
    seen.add(target);
    if (!root || !is_inside(root, target) || is_secret_path(target)) {
      if (required) { complete = false; fingerprints.push(target + ":uninspected"); }
      return "";
    }
    try {
      const real = await fs.realpath(target);
      if (!is_inside(root, real) || is_secret_path(real)) {
        complete = false; fingerprints.push(target + ":linked-outside-or-protected"); return "";
      }
      const source = await bounded_text(real);
      fingerprints.push(real + ":" + source.hash);
      total += source.text.length;
      if (!source.complete || total > source_chars) { complete = false; return ""; }
      contents.push(real + "\n" + source.text);
      return source.text;
    } catch (error) {
      if (required || error_code(error) !== "ENOENT") {
        complete = false; fingerprints.push(target + ":unavailable");
        console.warn("[permissions] source inspection failed for " + target + ": " + error_text(error));
      }
      return "";
    }
  };
  if (root) {
    const agent_doc = await add(path.join(root, "AGENTS.md"), false);
    if (!agent_doc) await add(path.join(root, "CLAUDE.md"), false);
  }
  let location = cwd || root;
  for (const statement of split_statements(command)) {
    const change = directory_change.exec(statement.trim());
    if (change) {
      const target = change[1]?.trim() ?? "";
      if (!target || /[$\x60]/.test(target)) { complete = false; fingerprints.push("dynamic-cwd:" + statement); }
      else location = path.resolve(location, target);
    }
    const refs = [...statement.matchAll(script_pattern)].map(match => match[1]);
    const direct = direct_script.exec(statement.trim())?.[1];
    const ps = powershell_file.exec(statement)?.[1];
    for (const file of [...refs, ...(direct ? [direct] : []), ...(ps ? [ps] : [])]) await add(path.resolve(location, file), true);
    if (/^(?:npm|pnpm|yarn)(?:\.cmd)?\s+(?:run|test|build|start)\b/i.test(statement.trim())) {
      const manifest = await add(path.join(location, "package.json"), true);
      if (manifest) {
        try {
          const parsed = JSON.parse(manifest) as { scripts?: Record<string, string> };
          const name = /^(?:npm|pnpm|yarn)(?:\.cmd)?\s+(?:run\s+)?([\w:-]+)/i.exec(statement.trim())?.[1];
          const script = name ? parsed.scripts?.[name] : null;
          if (script) for (const match of script.matchAll(script_pattern)) await add(path.resolve(location, match[1]), true);
        } catch (error) {
          complete = false; console.warn("[permissions] package script inspection failed: " + error_text(error));
        }
      }
    }
  }
  return { text: contents.join("\n\n"), hash: permission_hash(fingerprints.join("\n")), complete, protected_read: protected_command_read(command) };
};
