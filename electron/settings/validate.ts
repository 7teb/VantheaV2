import type { McpTier } from "../../shared/approval.ts";
import type { PermissionMode } from "../../shared/chat.ts";
import { compact_fraction } from "../../shared/chat.ts";
import { min_context_limit, type Language, type McpServerConfig, type McpToolOverride, type ModelContext, type Personality, type ProjectEntry, type Settings } from "../../shared/settings.ts";
import { as_array, as_boolean, as_record, as_string, clamp_int, is_record, pick } from "../storage/coerce.ts";
import { folder_name, path_key } from "../storage/paths.ts";

const languages: readonly Language[] = ["en", "de"];
const modes: readonly PermissionMode[] = ["ask", "auto", "full"];
const personalities: readonly Personality[] = ["pragmatic", "friendly", "cynical"];
const search_depths = ["basic", "advanced"] as const;
const search_topics = ["general", "news"] as const;
const image_qualities = ["auto", "low", "medium", "high"] as const;
const mcp_tiers: readonly McpTier[] = ["readonly", "state_change", "dangerous", "shell_system"];

const struct_keys = new Set<keyof Settings>(["memory", "web_search", "image_gen", "skills"]);

const max_projects = 500;
const max_project_name = 80;
const server_name_pattern = /^[A-Za-z0-9_-]{1,40}$/;
const effort_pattern = /^[a-z_]{1,16}$/;

export const default_settings = (): Settings => ({
  language: "en",
  model: "deepseek/deepseek-v4.1-flash-1017",
  effort: "high",
  mode: "auto",
  projects: [],
  personality: "pragmatic",
  custom_instructions: "",
  memory: { enabled: false, exclude_tool_chats: false },
  web_search: { enabled: false, max_results: 5, depth: "basic", topic: "general" },
  image_gen: { enabled: false, model: "google/gemini-3.1-flash-image", quality: "auto" },
  mcp_servers: {},
  mcp_tools: {},
  skills: { disabled: [] },
  model_context: {},
});

const model_id = (value: unknown, fallback: string): string => {
  const id = as_string(value).trim();
  if (!id || id.length > 200 || id.startsWith("nvidia:")) {
    return fallback;
  }
  return id;
};

const effort = (value: unknown, fallback: string): string => {
  const text = as_string(value);
  return effort_pattern.test(text) ? text : fallback;
};

export const project_name = (value: unknown, project_path: string): string =>
  as_string(value).trim().slice(0, max_project_name) || folder_name(project_path);

const projects = (value: unknown, fallback: ProjectEntry[]): ProjectEntry[] => {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const seen = new Set<string>();
  const out: ProjectEntry[] = [];
  for (const entry of value) {
    const raw = as_record(entry);
    const project_path = as_string(raw.path).trim();
    const key = path_key(project_path);
    if (!project_path || project_path.length > 1000 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ path: project_path, name: project_name(raw.name, project_path), pinned: as_boolean(raw.pinned, false), folder_id: as_string(raw.folder_id).slice(0, 80) });
  }
  return out.slice(0, max_projects);
};

const string_list = (value: unknown, fallback: string[], max_length: number): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= max_length))]
    : fallback;

const string_map = (value: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(as_record(value)).filter((entry): entry is [string, string] => typeof entry[1] === "string"));

const mcp_server = (value: unknown): McpServerConfig | null => {
  const raw = as_record(value);
  const command = as_string(raw.command).trim();
  if (!command) {
    return null;
  }
  return {
    command,
    args: as_array(raw.args).filter((item): item is string => typeof item === "string"),
    cwd: as_string(raw.cwd),
    env: string_map(raw.env),
    enabled: as_boolean(raw.enabled, true),
  };
};

const mcp_servers = (value: unknown, fallback: Record<string, McpServerConfig>): Record<string, McpServerConfig> => {
  if (!is_record(value)) {
    return fallback;
  }
  const out: Record<string, McpServerConfig> = {};
  for (const [name, config] of Object.entries(value)) {
    const server = mcp_server(config);
    if (server_name_pattern.test(name) && server) {
      out[name] = server;
    }
  }
  return out;
};

const mcp_tool = (value: unknown): McpToolOverride => {
  const raw = as_record(value);
  return {
    risk: mcp_tiers.find((tier) => tier === raw.risk) ?? null,
    enabled: as_boolean(raw.enabled, true),
  };
};

const mcp_tools = (value: unknown, fallback: Record<string, McpToolOverride>): Record<string, McpToolOverride> => {
  if (!is_record(value)) {
    return fallback;
  }
  const out: Record<string, McpToolOverride> = {};
  for (const [key, override] of Object.entries(value)) {
    const [server = "", tool = ""] = key.split("/", 2);
    if (server_name_pattern.test(server) && tool && key.length <= 200) {
      out[key] = mcp_tool(override);
    }
  }
  return out;
};

const model_context = (value: unknown): ModelContext => {
  const raw = as_record(value);
  return {
    limit: typeof raw.limit === "number" ? clamp_int(raw.limit, min_context_limit, 100_000_000, min_context_limit) : null,
    compact_percent: clamp_int(raw.compact_percent, 50, 95, Math.round(compact_fraction * 100)),
  };
};

const model_contexts = (value: unknown, fallback: Record<string, ModelContext>): Record<string, ModelContext> => {
  if (!is_record(value)) {
    return fallback;
  }
  const out: Record<string, ModelContext> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (id && id.length <= 200) {
      out[id] = model_context(entry);
    }
  }
  return out;
};

export const normalize_settings = (value: unknown, base: Settings): Settings => {
  const raw = as_record(value);
  const memory = as_record(raw.memory);
  const web = as_record(raw.web_search);
  const image = as_record(raw.image_gen);
  const skills = as_record(raw.skills);
  return {
    language: pick(raw.language, languages, base.language),
    model: model_id(raw.model, base.model),
    effort: effort(raw.effort, base.effort),
    mode: pick(raw.mode, modes, base.mode),
    projects: projects(raw.projects, base.projects),
    personality: pick(raw.personality, personalities, base.personality),
    custom_instructions: as_string(raw.custom_instructions, base.custom_instructions),
    memory: {
      enabled: as_boolean(memory.enabled, base.memory.enabled),
      exclude_tool_chats: as_boolean(memory.exclude_tool_chats, base.memory.exclude_tool_chats),
    },
    web_search: {
      enabled: as_boolean(web.enabled, base.web_search.enabled),
      max_results: clamp_int(web.max_results, 1, 20, base.web_search.max_results),
      depth: pick(web.depth, search_depths, base.web_search.depth),
      topic: pick(web.topic, search_topics, base.web_search.topic),
    },
    image_gen: {
      enabled: as_boolean(image.enabled, base.image_gen.enabled),
      model: model_id(image.model, base.image_gen.model),
      quality: pick(image.quality, image_qualities, base.image_gen.quality),
    },
    mcp_servers: mcp_servers(raw.mcp_servers, base.mcp_servers),
    mcp_tools: mcp_tools(raw.mcp_tools, base.mcp_tools),
    skills: { disabled: string_list(skills.disabled, base.skills.disabled, 200) },
    model_context: model_contexts(raw.model_context, base.model_context),
  };
};

export const merge_settings = (current: Settings, patch: unknown): Settings => {
  const raw = as_record(patch);
  const merged: Record<string, unknown> = { ...current };
  for (const key of Object.keys(current) as (keyof Settings)[]) {
    if (!Object.hasOwn(raw, key)) {
      continue;
    }
    const value = raw[key];
    merged[key] = struct_keys.has(key) && is_record(value) ? { ...as_record(current[key]), ...value } : value;
  }
  return normalize_settings(merged, current);
};
