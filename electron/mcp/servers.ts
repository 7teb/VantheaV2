import { isDeepStrictEqual } from "node:util";
import type { McpTier } from "../../shared/approval.ts";
import type { McpServerStatus, McpToolStatus } from "../../shared/ipc/extensions.ts";
import { mcp_tool_key, type McpServerConfig, type McpToolOverride, type Settings, type SettingsPatch } from "../../shared/settings.ts";
import { invalidate_tools, kill_all_servers_sync, observe_servers, on_servers_changed, ready_servers, reconnect_server, server_config_id, server_runtime, sync_servers, tool_is_current, type McpToolInfo } from "./client.ts";
import { is_trusted, set_server_trust } from "./grants.ts";
import { apply_override } from "./risk.ts";

export type SettingsAccess = { get: () => Settings; update: (patch: SettingsPatch) => Promise<unknown> };

let settings_access: SettingsAccess | null = null;

export const set_settings_access = (access: SettingsAccess) => {
  settings_access = access;
  observe_mcp_settings(access.get());
};

const current_settings = (): Settings => {
  if (!settings_access) {
    throw new Error("MCP settings access is not initialized.");
  }
  return settings_access.get();
};

const update_settings = (patch: SettingsPatch) => {
  if (!settings_access) {
    throw new Error("MCP settings access is not initialized.");
  }
  const saved = settings_access.update(patch);
  if (patch.mcp_servers || patch.mcp_tools) {
    observe_mcp_settings(current_settings());
  }
  return saved;
};

export const configured_servers = (): [string, McpServerConfig][] =>
  Object.entries(current_settings().mcp_servers).filter((entry): entry is [string, McpServerConfig] => Boolean(entry[1]));

const tool_override = (server: string, tool: string): McpToolOverride | null => current_settings().mcp_tools[mcp_tool_key(server, tool)] ?? null;

export const effective_tier = (server: string, tool: McpToolInfo): McpTier => apply_override(tool.heuristic, tool_override(server, tool.name)?.risk ?? null);

export const tool_enabled = (server: string, tool: string) => tool_override(server, tool)?.enabled ?? true;

export const current_tool_config = (server: string, tool: McpToolInfo) => {
  const config = current_settings().mcp_servers[server];
  if (!config?.enabled || !tool_enabled(server, tool.name)) {
    return null;
  }
  return tool_is_current(server, tool, config) ? config : null;
};

const tool_status = (server: string, tool: McpToolInfo): McpToolStatus => {
  const override = tool_override(server, tool.name);
  return {
    name: tool.name,
    description: tool.description.slice(0, 300),
    tier: effective_tier(server, tool),
    enabled: override?.enabled ?? true,
    overridden: Boolean(override && override.risk !== null),
  };
};

export const mcp_status = (): McpServerStatus[] =>
  configured_servers().map(([name, config]) => {
    const runtime = config.enabled ? server_runtime(name) : null;
    return {
      name,
      config_id: server_config_id(name),
      config,
      state: runtime?.state ?? "stopped",
      error: runtime?.error ?? "",
      trusted: is_trusted(name),
      tools: (runtime?.tools ?? []).map((tool) => tool_status(name, tool)),
      stderr_tail: runtime?.stderr_tail ?? "",
    };
  });

let observed_tools: Settings["mcp_tools"] = {};

export const observe_mcp_settings = (settings: Settings) => {
  observe_servers(settings.mcp_servers);
  const next = settings.mcp_tools;
  if (isDeepStrictEqual(observed_tools, next)) {
    return;
  }
  invalidate_tools((server, info) => {
    const key = mcp_tool_key(server, info.name);
    const before = observed_tools[key];
    const after = next[key];
    if ((before?.enabled ?? true) !== (after?.enabled ?? true)) {
      return true;
    }

    return apply_override(info.heuristic, before?.risk ?? null) !== apply_override(info.heuristic, after?.risk ?? null);
  });
  observed_tools = structuredClone(next);
};

export const sync_mcp = () => sync_servers(current_settings().mcp_servers);

export const set_config_trust = (server: string, config_id: string, trusted: boolean) => {
  if (server_config_id(server) !== config_id) {
    throw new Error(`MCP server ${server} was replaced. Refresh its status before changing trust.`);
  }
  if (is_trusted(server) === trusted) {
    return;
  }
  set_server_trust(server, trusted);
  invalidate_tools((name) => name === server);
};

export const init_mcp = () => sync_mcp();

export const shutdown_mcp = () => kill_all_servers_sync();

export const on_mcp_changed = (listener: () => void) => on_servers_changed(listener);

const without_server_tools = (name: string) => {
  const prefix = mcp_tool_key(name, "");
  return Object.fromEntries(Object.entries(current_settings().mcp_tools).map(([key, value]) => [key, key.startsWith(prefix) ? undefined : value]));
};

export const server_exists = (name: string) => Object.hasOwn(current_settings().mcp_servers, name);

export const server_of_tool = (spec_name: string): { name: string } | null => {
  const server = ready_servers().find((entry) => entry.tools.some((tool) => tool.spec_name === spec_name));
  return server ? { name: server.name } : null;
};

export const upsert_server = async (name: string, config: McpServerConfig, options: { reset_trust: boolean } = { reset_trust: false }) => {
  const previous = current_settings().mcp_servers[name];
  const replaced = previous !== undefined && !isDeepStrictEqual(previous, config);
  if (options.reset_trust && replaced) {
    set_server_trust(name, false);
    await update_settings({ mcp_servers: { ...current_settings().mcp_servers, [name]: config }, mcp_tools: without_server_tools(name) });
  } else {
    await update_settings({ mcp_servers: { ...current_settings().mcp_servers, [name]: config } });
  }
  await sync_mcp();
};

export const remove_server = async (name: string) => {
  await update_settings({ mcp_servers: { ...current_settings().mcp_servers, [name]: undefined }, mcp_tools: without_server_tools(name) });
  await sync_mcp();
};

export const reconnect_mcp_server = (name: string) => reconnect_server(name);

export const set_tool_override = async (server: string, tool: string, patch: { risk?: McpTier | null; enabled?: boolean }) => {
  const key = mcp_tool_key(server, tool);
  const tools = current_settings().mcp_tools;
  const existing = tools[key];
  const next: McpToolOverride = { risk: patch.risk === undefined ? (existing?.risk ?? null) : patch.risk, enabled: patch.enabled ?? existing?.enabled ?? true };
  const is_default = next.risk === null && next.enabled;
  await update_settings({ mcp_tools: { ...tools, [key]: is_default ? undefined : next } });
};
