import type { McpServerConfig } from "../../../shared/settings.ts";
import { detect_server } from "../../mcp/detect.ts";
import { mcp_status, server_exists, upsert_server } from "../../mcp/servers.ts";
import { sanitize_server_name } from "../../mcp/specs.ts";
import { define_tool, ToolArgumentError, type ToolResult } from "../types.ts";

type AddArgs = { folder: string | null; name: string | null; command: string | null; args: string[] | null; env: Record<string, string> | null };

const optional_text = (raw: Record<string, unknown>, key: string) => {
  const value = raw[key];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new ToolArgumentError(`${key} must be a string`);
  }
  return value;
};

const parse_add_args = (raw: Record<string, unknown>): AddArgs => {
  const args = raw.args;
  if (args !== undefined && (!Array.isArray(args) || args.some((entry) => typeof entry !== "string"))) {
    throw new ToolArgumentError("args must be a list of strings");
  }
  const env = raw.env;
  if (env !== undefined && (!env || typeof env !== "object" || Array.isArray(env) || Object.values(env).some((entry) => typeof entry !== "string"))) {
    throw new ToolArgumentError("env must be a flat map of string values");
  }
  return {
    folder: optional_text(raw, "folder"),
    name: optional_text(raw, "name"),
    command: optional_text(raw, "command"),
    args: (args as string[] | undefined) ?? null,
    env: (env as Record<string, string> | undefined) ?? null,
  };
};

const result = (status: ToolResult["status"], name: string, text: string): ToolResult => ({
  status,
  text,
  view: { kind: "mcp", server: name, tool: "add_mcp_server", text, is_error: status !== "done" },
});

export const add_mcp_server_tool = define_tool<AddArgs>({
  spec: {
    name: "add_mcp_server",
    description:
      "Connect a local MCP server so its tools become available as mcp__<server>__<tool>. Use it when the user asks to add, connect or set up an MCP server (for example an IDA or Cheat Engine bridge). Prefer folder = the absolute path to the server's folder: the app reads its README and files and detects the launch command. Pass name, command, args and env only when the user gave the exact config. The user must approve before the server is added.",
    parameters: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Absolute path to the MCP server's folder." },
        name: { type: "string", description: "Short server name (letters, digits, _ and -). Optional with folder." },
        command: { type: "string", description: "Launch executable, for example uvx, python, npx or a full interpreter path." },
        args: { type: "array", items: { type: "string" } },
        env: { type: "object", description: "Flat map of environment variable names to string values." },
      },
      additionalProperties: false,
    },
  },
  profiles: ["main"],
  parse: parse_add_args,
  run: async (ctx, args) => {
    const detected = args.folder ? await detect_server(args.folder) : null;
    const name = sanitize_server_name(args.name ?? detected?.name ?? "");
    const command = (args.command ?? detected?.config.command ?? "").trim();
    if (!name || !command) {
      const hint = detected?.note ?? "Ask the user for the exact launch command and arguments from the server's README, or have them add it in Settings.";
      return result("failed", name, `Could not determine how to launch this MCP server${args.folder ? ` from ${args.folder}` : ""}. ${hint}`);
    }
    const config: McpServerConfig = {
      command,
      args: args.args ?? detected?.config.args ?? [],
      cwd: detected?.config.cwd ?? "",
      env: args.env ?? detected?.config.env ?? {},
      enabled: true,
    };
    const decision = await ctx.approve({
      kind: "mcp_server",
      name,
      command,
      args: config.args,
      cwd: config.cwd,
      env: config.env,
      replaces: server_exists(name),
    });
    if (!decision.approved) {
      const feedback = decision.feedback ? ` User feedback: ${decision.feedback}` : "";
      return result("denied", name, `The user declined adding MCP server ${name}.${feedback}`);
    }
    await upsert_server(name, config, { reset_trust: true });
    const status = mcp_status().find((entry) => entry.name === name);
    if (status?.state !== "ready") {
      const stderr = status?.stderr_tail ? `\nServer stderr:\n${status.stderr_tail.slice(-1500)}` : "";
      return result("failed", name, `MCP server ${name} was added but did not start: ${status?.error || "unknown state"}.${stderr}`);
    }
    const source = detected ? ` Detected from ${args.folder} (${detected.source}): ${detected.note}` : "";
    return result("done", name, `MCP server ${name} is connected with ${status.tools.length} tools, available as mcp__${name}__<tool>.${source}`);
  },
});
