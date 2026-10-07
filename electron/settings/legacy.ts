import type { SecretName, Settings } from "../../shared/settings.ts";
import { as_array, as_record, as_string, is_record } from "../storage/coerce.ts";
import { default_settings, normalize_settings } from "./validate.ts";

export type LegacySettingsImport = { settings: Settings; secrets: Record<SecretName, string | null> };

const base64_pattern = /^[A-Za-z0-9+/]+={0,2}$/;

const cipher = (value: unknown): string | null => {
  const text = as_string(value).trim();
  return text && base64_pattern.test(text) ? text : null;
};

const legacy_effort = (value: unknown): unknown => (value === "major" ? "xhigh" : value);

const legacy_projects = (list: unknown, meta: unknown) => {
  const names = as_record(meta);
  return as_array(list)
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((project_path) => {
      const entry = as_record(names[project_path]);
      return { path: project_path, name: as_string(entry.name).trim(), pinned: entry.pinned === true };
    });
};

const legacy_mcp_servers = (value: unknown) =>
  Object.fromEntries(
    Object.entries(as_record(value)).map(([name, config]) => {
      const raw = as_record(config);
      return [name, { command: raw.command, args: raw.args, cwd: raw.cwd, env: raw.env, enabled: raw.enabled !== false }];
    }),
  );

const legacy_mcp_tools = (value: unknown): Record<string, { risk: unknown; enabled: boolean }> => {
  const out: Record<string, { risk: unknown; enabled: boolean }> = {};
  for (const [server, config] of Object.entries(as_record(value))) {
    const raw = as_record(config);
    const risks = as_record(raw.toolRisk);
    const enabled = as_record(raw.toolEnabled);
    for (const tool of new Set([...Object.keys(risks), ...Object.keys(enabled)])) {
      out[`${server}/${tool}`] = { risk: risks[tool], enabled: enabled[tool] !== false };
    }
  }
  return out;
};

export const convert_legacy_settings = (value: unknown): LegacySettingsImport => {
  const raw = as_record(value);
  const memory = as_record(raw.memory);
  const web = as_record(raw.webSearch);
  const image = as_record(raw.imageGen);
  const skills = is_record(raw.skills) ? raw.skills : {};
  const settings = normalize_settings(
    {
      language: raw.language,
      model: raw.model,
      effort: legacy_effort(raw.effort),
      mode: raw.mode,
      projects: legacy_projects(raw.projects, raw.projectMeta),
      personality: raw.personality,
      custom_instructions: raw.customInstructions,
      memory: { enabled: memory.enabled, exclude_tool_chats: memory.excludeToolChats },
      web_search: { enabled: web.enabled, max_results: web.maxResults, depth: web.searchDepth, topic: web.topic },
      image_gen: { enabled: image.enabled, model: image.model, quality: image.quality },
      mcp_servers: legacy_mcp_servers(raw.mcpServers),
      mcp_tools: legacy_mcp_tools(raw.mcpServers),
      skills: { disabled: skills.disabled },
    },
    default_settings(),
  );
  return { settings, secrets: { openrouter: cipher(raw.openRouterKey), tavily: cipher(raw.tavilyKey) } };
};
