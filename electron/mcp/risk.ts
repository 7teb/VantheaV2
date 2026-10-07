import type { McpTier } from "../../shared/approval.ts";

export type ToolShape = { name: string; description: string; input_schema: unknown };

export const mcp_tiers: readonly McpTier[] = ["readonly", "state_change", "dangerous", "shell_system"];

const shell_name = /(^|_)(run_command|shell_execute|exec|create_process|open_process|spawn|launch|start_process)(_|$)/i;
const shell_strong_keys = new Set(["command", "cmd", "commandline", "command_line", "script", "powershell", "shell", "exec"]);
const shell_weak_keys = new Set(["path", "exe", "program", "file", "application", "executable"]);
const exec_verb = /\b(run|execute|spawn|shell|create[_ ]?process|open[_ ]?process|launch|start)\b/i;
const dangerous_name =
  /(write_|write_memory|write_process|patch|inject|auto_assemble|(?<![a-z])assemble|execute_code|execute_method|create_thread|alloc|allocate|set_memory_protection|freeze|modify|kernel|dbvm|dbk_|cr3|map_memory|set_context|poke|unprotect)/i;
const dangerous_description = /\b(writes?|modif(y|ies)|injects?|patch(es)?|execute|executes|allocat(e|es)|overwrites?)\b/i;
const write_payload_keys = new Set(["bytes", "data", "value", "buffer", "assembly", "opcodes", "payload", "content"]);
const target_keys = new Set(["address", "addr", "pid", "handle", "base"]);
const state_change_name = /(rename|set_|add_|create_|delete_|remove_|comment|label|breakpoint|register_|declare_|define_|save_|import|apply|update_)/i;
const readonly_name = /(read_|list_|get_|disassemble|decompile|search|scan|enum_|analyze|find_|metadata|info|check_|xref|dump)/i;

const schema_keys = (schema: unknown): string[] => {
  const properties = (schema as { properties?: unknown } | null)?.properties;
  if (!properties || typeof properties !== "object") {
    return [];
  }
  return Object.keys(properties).map((key) => key.toLowerCase());
};

export const classify_risk = (tool: ToolShape): McpTier => {
  const name = tool.name.toLowerCase();
  const keys = schema_keys(tool.input_schema);
  const has_key = (set: Set<string>) => keys.some((key) => set.has(key));
  if (shell_name.test(name) || has_key(shell_strong_keys)) {
    return "shell_system";
  }
  if (has_key(shell_weak_keys) && (exec_verb.test(name) || exec_verb.test(tool.description))) {
    return "shell_system";
  }
  if (dangerous_name.test(name) || dangerous_description.test(tool.description)) {
    return "dangerous";
  }
  if (has_key(write_payload_keys) && has_key(target_keys)) {
    return "dangerous";
  }
  if (state_change_name.test(name)) {
    return "state_change";
  }
  if (readonly_name.test(name) && !has_key(write_payload_keys)) {
    return "readonly";
  }
  return "state_change";
};

export const apply_override = (heuristic: McpTier, override: McpTier | null): McpTier => {
  if (!override || !mcp_tiers.includes(override) || override === heuristic) {
    return heuristic;
  }
  if (heuristic === "shell_system" || override === "shell_system") {
    return "shell_system";
  }
  if (heuristic === "dangerous" && override === "readonly") {
    return "state_change";
  }
  return override;
};

const command_keys = ["command", "cmd", "commandline", "command_line", "script", "exec", "powershell", "shell", "path", "exe", "program"];

export const extract_command_arg = (args: Record<string, unknown>): string | null => {
  for (const [key, value] of Object.entries(args)) {
    if (!command_keys.includes(key.toLowerCase())) {
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (Array.isArray(value)) {
      const joined = value.filter((item): item is string => typeof item === "string").join(" ");
      if (joined.trim()) {
        return joined;
      }
    }
  }
  return null;
};

export const collect_arg_strings = (value: unknown, depth = 0, out: string[] = []): string[] => {
  if (depth > 6 || out.length > 200) {
    return out;
  }
  if (typeof value === "string") {
    if (value) {
      out.push(value);
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collect_arg_strings(item, depth + 1, out);
    }
    return out;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collect_arg_strings(item, depth + 1, out);
    }
  }
  return out;
};

export const shell_candidates = (args: Record<string, unknown>): string[] => {
  const strings = collect_arg_strings(args);
  const primary = extract_command_arg(args) ?? strings.join(" ");
  return [...new Set([primary, ...strings, strings.join(" ")].filter(Boolean))];
};

const scope_fields: [string, string[], boolean][] = [
  ["pid", ["pid", "processid", "process_id"], false],
  ["process", ["process", "processname", "process_name", "executable"], true],
  ["module", ["module", "modulename", "module_name", "dll"], true],
  ["address", ["address", "addr", "base"], false],
  ["size", ["size", "length", "len", "count"], false],
];

export const target_scope = (args: Record<string, unknown>): string | null => {
  const scope = new Map<string, string>();
  for (const [key, value] of Object.entries(args)) {
    const lower = key.toLowerCase();
    const field = scope_fields.find(([, aliases]) => aliases.includes(lower));
    if (field) {
      const text = String(value);
      scope.set(field[0], field[2] ? text.toLowerCase() : text);
    }
  }
  if (!scope.size) {
    return null;
  }
  return scope_fields.map(([name]) => `${name}=${scope.get(name) ?? ""}`).join("|");
};
