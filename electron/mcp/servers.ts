import type { McpTier } from "../../shared/approval.ts";
import type { McpServerStatus, McpToolStatus } from "../../shared/ipc/extensions.ts";
import { mcp_tool_key, type McpServerConfig, type McpToolOverride, type Settings, type SettingsPatch } from "../../shared/settings.ts";
import { kill_all_servers_sync, on_servers_changed, reconnect_server, server_runtime, sync_servers, type McpToolInfo } from "./client.ts";
import { apply_override } from "./risk.ts";

export type SettingsAccess = { get: () => Settings; update: (patch: SettingsPatch) => Promise<unknown> };

let settings_access: SettingsAccess | null = null;

const trusted_servers = new Set<string>();

export const set_settings_access = (access: SettingsAccess) => {
  settings_access = access;
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
  return settings_access.update(patch);
};

export const configured_servers = (): [string, McpServerConfig][] =>
  Object.entries(current_settings().mcp_servers).filter((entry): entry is [string, McpServerConfig] => Boolean(entry[1]));

const tool_override = (server: string, tool: string): McpToolOverride | null => current_settings().mcp_tools[mcp_tool_key(server, tool)] ?? null;

export const effective_tier = (server: string, tool: McpToolInfo): McpTier => apply_override(tool.heuristic, tool_override(server, tool.name)?.risk ?? null);

export const tool_enabled = (server: string, tool: string) => tool_override(server, tool)?.enabled ?? true;

export const is_trusted = (server: string) => trusted_servers.has(server);

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
      config,
      state: runtime?.state ?? "stopped",
      error: runtime?.error ?? "",
      trusted: trusted_servers.has(name),
      tools: (runtime?.tools ?? []).map((tool) => tool_status(name, tool)),
      stderr_tail: runtime?.stderr_tail ?? "",
    };
  });

export const sync_mcp = () => sync_servers(current_settings().mcp_servers);

export const init_mcp = () => sync_mcp();

export const shutdown_mcp = () => kill_all_servers_sync();

export const on_mcp_changed = (listener: () => void) => on_servers_changed(listener);

const without_server_tools = (name: string) => {
  const prefix = mcp_tool_key(name, "");
  return Object.fromEntries(Object.entries(current_settings().mcp_tools).map(([key, value]) => [key, key.startsWith(prefix) ? undefined : value]));
};

export const server_exists = (name: string) => Object.hasOwn(current_settings().mcp_servers, name);

export const upsert_server = async (name: string, config: McpServerConfig, options: { reset_trust: boolean } = { reset_trust: false }) => {
  const previous = current_settings().mcp_servers[name];
  const replaced = previous !== undefined && JSON.stringify(previous) !== JSON.stringify(config);
  if (options.reset_trust && replaced) {
    trusted_servers.delete(name);
    await update_settings({ mcp_servers: { ...current_settings().mcp_servers, [name]: config }, mcp_tools: without_server_tools(name) });
  } else {
    await update_settings({ mcp_servers: { ...current_settings().mcp_servers, [name]: config } });
  }
  await sync_mcp();
};

export const remove_server = async (name: string) => {
  await update_settings({ mcp_servers: { ...current_settings().mcp_servers, [name]: undefined }, mcp_tools: without_server_tools(name) });
  trusted_servers.delete(name);
  await sync_mcp();
};

export const reconnect_mcp_server = (name: string) => reconnect_server(name, current_settings().mcp_servers[name]);

export const set_tool_override = async (server: string, tool: string, patch: { risk?: McpTier | null; enabled?: boolean }) => {
  const key = mcp_tool_key(server, tool);
  const tools = current_settings().mcp_tools;
  const existing = tools[key];
  const next: McpToolOverride = { risk: patch.risk === undefined ? (existing?.risk ?? null) : patch.risk, enabled: patch.enabled ?? existing?.enabled ?? true };
  const is_default = next.risk === null && next.enabled;
  await update_settings({ mcp_tools: { ...tools, [key]: is_default ? undefined : next } });
};

export const set_server_trust = (server: string, trusted: boolean) => {
  if (trusted) {
    trusted_servers.add(server);
  } else {
    trusted_servers.delete(server);
  }
};
