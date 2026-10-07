import { dialog } from "electron";
import type { McpTier } from "../../shared/approval.ts";
import type { McpServerConfig } from "../../shared/settings.ts";
import { main_window } from "../app/window.ts";
import { detect_server } from "../mcp/detect.ts";
import { mcp_tiers } from "../mcp/risk.ts";
import { configured_servers, mcp_status, on_mcp_changed, reconnect_mcp_server, remove_server, set_server_trust, set_tool_override, upsert_server } from "../mcp/servers.ts";
import { sanitize_server_name } from "../mcp/specs.ts";
import { emit, handle } from "./handle.ts";

const server_name = (value: unknown) => {
  const name = typeof value === "string" ? sanitize_server_name(value) : "";
  if (!name || name !== value) {
    throw new Error(`invalid MCP server name: ${String(value).slice(0, 80)}`);
  }
  return name;
};

const known_server = (value: unknown) => {
  if (typeof value !== "string" || !configured_servers().some(([name]) => name === value)) {
    throw new Error(`unknown MCP server: ${String(value).slice(0, 80)}`);
  }
  return value;
};

const tool_name = (value: unknown) => {
  if (typeof value !== "string" || !value) {
    throw new Error("tool must be a non-empty string");
  }
  return value;
};

const string_list = (value: unknown, field: string) => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${field} must be a list of strings`);
  }
  return value as string[];
};

const string_map = (value: unknown, field: string) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some((entry) => typeof entry !== "string")) {
    throw new Error(`${field} must be a map of strings`);
  }
  return value as Record<string, string>;
};

const valid_config = (value: McpServerConfig): McpServerConfig => {
  if (typeof value?.command !== "string" || !value.command.trim()) {
    throw new Error("command must be a non-empty string");
  }
  if (typeof value.cwd !== "string" || typeof value.enabled !== "boolean") {
    throw new Error("cwd must be a string and enabled a boolean");
  }
  return { command: value.command.trim(), args: string_list(value.args, "args"), cwd: value.cwd, env: string_map(value.env, "env"), enabled: value.enabled };
};

const valid_patch = (patch: { risk?: McpTier | null; enabled?: boolean }) => {
  if (patch.risk !== undefined && patch.risk !== null && !mcp_tiers.includes(patch.risk)) {
    throw new Error(`invalid MCP risk tier: ${String(patch.risk)}`);
  }
  if (patch.enabled !== undefined && typeof patch.enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }
  return { risk: patch.risk, enabled: patch.enabled };
};

const choose_folder = async () => {
  const window = main_window();
  const options = { properties: ["openDirectory" as const], title: "Choose the MCP server's folder" };
  const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  return picked.canceled ? null : (picked.filePaths[0] ?? null);
};

export const register_mcp_ipc = () => {
  on_mcp_changed(() => emit("mcp:changed", mcp_status()));
  handle("mcp:status", () => mcp_status());
  handle("mcp:upsert", async (name, config) => {
    await upsert_server(server_name(name), valid_config(config));
    return mcp_status();
  });
  handle("mcp:remove", async (name) => {
    await remove_server(known_server(name));
    return mcp_status();
  });
  handle("mcp:reconnect", async (name) => {
    await reconnect_mcp_server(known_server(name));
    return mcp_status();
  });
  handle("mcp:set_tool", async (server, tool, patch) => {
    await set_tool_override(known_server(server), tool_name(tool), valid_patch(patch ?? {}));
    return mcp_status();
  });
  handle("mcp:set_trust", (server, trusted) => {
    set_server_trust(known_server(server), trusted === true);
    return mcp_status();
  });
  handle("mcp:detect_folder", async () => {
    const folder = await choose_folder();
    if (!folder) {
      return null;
    }
    const detected = await detect_server(folder);
    return { name: detected.name, config: detected.config };
  });
};
