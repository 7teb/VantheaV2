import type { McpServerConfig } from "../../../../shared/settings.ts";

export type McpDraft = { name: string; command: string; args: string; env: string; cwd: string };

export const empty_draft: McpDraft = { name: "", command: "", args: "", env: "", cwd: "" };

const server_name_pattern = /^[a-zA-Z0-9_-]{1,40}$/;

const is_record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export const clean_server_name = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export const valid_server_name = (value: string) => server_name_pattern.test(value);

export const config_draft = (name: string, config: McpServerConfig): McpDraft => ({
  name: clean_server_name(name),
  command: config.command,
  args: config.args.join("\n"),
  env: Object.entries(config.env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n"),
  cwd: config.cwd,
});

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

export const draft_config = (draft: McpDraft): McpServerConfig => {
  const env: Record<string, string> = {};
  for (const line of lines(draft.env)) {
    const split = line.indexOf("=");
    if (split > 0) {
      env[line.slice(0, split).trim()] = line.slice(split + 1).trim();
    }
  }
  return { command: draft.command.trim(), args: lines(draft.args), cwd: draft.cwd.trim(), env, enabled: true };
};

const entry_draft = (name: string, entry: unknown): McpDraft | null => {
  if (!is_record(entry) || typeof entry.command !== "string" || !entry.command.trim()) {
    return null;
  }
  const args = Array.isArray(entry.args) ? entry.args.filter((arg): arg is string => typeof arg === "string") : [];
  const env = is_record(entry.env)
    ? Object.fromEntries(Object.entries(entry.env).filter((pair): pair is [string, string] => typeof pair[1] === "string"))
    : {};
  const cwd = typeof entry.cwd === "string" ? entry.cwd : "";
  return config_draft(name, { command: entry.command.trim(), args, env, cwd, enabled: true });
};

type Parsed = { ok: true; value: unknown } | { ok: false };

const try_parse = (candidate: string): Parsed => {
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch {
    return { ok: false };
  }
};

const parse_json = (text: string): unknown => {
  const cleaned = text.trim().replace(/,(\s*[}\]])/g, "$1");
  const direct = try_parse(cleaned);
  if (direct.ok) {
    return direct.value;
  }
  const wrapped = try_parse(`{${cleaned}}`);
  return wrapped.ok ? wrapped.value : null;
};

const server_group = (value: Record<string, unknown>) => {
  if (is_record(value.mcpServers)) {
    return value.mcpServers;
  }
  return is_record(value.servers) ? value.servers : null;
};

export const parse_pasted_config = (text: string, fallback_name: string): McpDraft | null => {
  const value = parse_json(text);
  if (!is_record(value)) {
    return null;
  }
  const group = server_group(value);
  if (group) {
    const [name, entry] = Object.entries(group)[0] ?? [];
    return name === undefined ? null : entry_draft(name, entry);
  }
  if (typeof value.command === "string") {
    return entry_draft(fallback_name, value);
  }
  const keys = Object.keys(value);
  return keys.length === 1 ? entry_draft(keys[0], value[keys[0]]) : null;
};
