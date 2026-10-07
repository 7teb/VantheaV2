import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import package_json from "../../package.json" with { type: "json" };
import type { McpTier } from "../../shared/approval.ts";
import type { McpServerConfig } from "../../shared/settings.ts";
import { kill_tree_sync } from "../shell/process.ts";
import { classify_risk } from "./risk.ts";
import { build_spec_name, format_result, type McpResultText } from "./specs.ts";

export type ServerState = "starting" | "ready" | "error";

export type McpToolInfo = { name: string; spec_name: string; description: string; input_schema: unknown; heuristic: McpTier };

export type ServerRuntime = { state: ServerState; error: string; tools: McpToolInfo[]; stderr_tail: string };

export type CallOptions = { signal: AbortSignal; timeout_ms: number; on_progress: (message: string) => void };

type ListedTool = { name: string; description?: string; inputSchema?: unknown };

type Entry = {
  name: string;
  signature: string;
  state: ServerState | "stopped";
  error: string;
  client: Client | null;
  transport: StdioClientTransport | null;
  tools: McpToolInfo[];
  stderr: string;
};

export const default_call_timeout_ms = 600000;
const start_timeout_ms = 30000;
const stderr_limit = 4000;
const max_tool_pages = 20;

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let chain: Promise<unknown> = Promise.resolve();
let shut_down = false;

const changed = () => {
  for (const listener of [...listeners]) {
    listener();
  }
};

export const on_servers_changed = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const serialize = <T>(work: () => Promise<T>): Promise<T> => {
  const run = chain.then(work);
  chain = Promise.allSettled([run]);
  return run;
};

const error_text = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);

const config_signature = (config: McpServerConfig) => JSON.stringify([config.command, config.args, config.cwd, config.env]);

const inherited_env = () => Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));

const kill_tree = (pid: number) =>
  new Promise<void>((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.once("error", (error) => {
      console.warn(`[mcp] taskkill for pid ${pid} failed: ${error.message}`);
      resolve();
    });
    killer.once("exit", () => resolve());
  });

const close_handles = async (entry: Entry) => {
  const { client, transport } = entry;
  entry.client = null;
  entry.transport = null;
  const pid = transport?.pid ?? null;
  if (pid && process.platform === "win32") {
    await kill_tree(pid);
  }
  if (!client) {
    return;
  }
  try {
    await client.close();
  } catch (error) {
    console.warn(`[mcp] closing server ${entry.name} failed: ${error_text(error)}`);
  }
};

const append_stderr = (entry: Entry, chunk: unknown) => {
  entry.stderr = `${entry.stderr}${String(chunk)}`.slice(-stderr_limit);
};

const build_tool_infos = (server: string, tools: ListedTool[]): McpToolInfo[] => {
  const used = new Set<string>();
  return tools.map((tool) => {
    const description = tool.description ?? "";
    return {
      name: tool.name,
      spec_name: build_spec_name(server, tool.name, used),
      description,
      input_schema: tool.inputSchema ?? null,
      heuristic: classify_risk({ name: tool.name, description, input_schema: tool.inputSchema }),
    };
  });
};

const list_all_tools = async (client: Client): Promise<ListedTool[]> => {
  const tools: ListedTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < max_tool_pages; page += 1) {
    const listed = await client.listTools(cursor ? { cursor } : undefined, { timeout: start_timeout_ms });
    tools.push(...listed.tools);
    cursor = listed.nextCursor;
    if (!cursor) {
      break;
    }
  }
  return tools;
};

const is_current = (entry: Entry) => entries.get(entry.name) === entry && entry.state !== "stopped";

const on_closed = (entry: Entry) => {
  if (!is_current(entry) || entry.state !== "ready") {
    return;
  }
  entry.state = "error";
  entry.error = "The server process exited or closed its connection.";
  entry.tools = [];
  console.warn(`[mcp] server ${entry.name} closed its connection`);
  void close_handles(entry);
  changed();
};

const on_tools_changed = (entry: Entry, error: Error | null, tools: ListedTool[] | null) => {
  if (!is_current(entry) || entry.state !== "ready") {
    return;
  }
  if (error) {
    console.warn(`[mcp] refreshing tools of ${entry.name} failed: ${error.message}`);
    return;
  }
  entry.tools = build_tool_infos(entry.name, tools ?? []);
  changed();
};

const start_server = async (name: string, config: McpServerConfig) => {
  if (shut_down) {
    return;
  }
  const entry: Entry = { name, signature: config_signature(config), state: "starting", error: "", client: null, transport: null, tools: [], stderr: "" };
  entries.set(name, entry);
  changed();
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: { ...inherited_env(), ...config.env },
    cwd: config.cwd || undefined,
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => append_stderr(entry, chunk));
  const client = new Client(
    { name: "VantheaX", version: package_json.version },
    { capabilities: {}, listChanged: { tools: { onChanged: (error, tools) => on_tools_changed(entry, error, tools) } } },
  );
  client.onclose = () => on_closed(entry);
  client.onerror = (error) => console.warn(`[mcp] server ${name} transport error: ${error.message}`);
  entry.client = client;
  entry.transport = transport;
  try {
    await client.connect(transport, { timeout: start_timeout_ms });
    const tools = await list_all_tools(client);
    if (!is_current(entry)) {
      return;
    }
    entry.tools = build_tool_infos(name, tools);
    entry.state = "ready";
  } catch (error) {
    console.warn(`[mcp] starting server ${name} (${config.command}) failed: ${error_text(error)}`);
    entry.state = "error";
    entry.error = error_text(error);
    entry.tools = [];
    await close_handles(entry);
  }
  changed();
};

const stop_server = async (name: string) => {
  const entry = entries.get(name);
  if (!entry) {
    return;
  }
  entry.state = "stopped";
  entries.delete(name);
  await close_handles(entry);
  changed();
};

export const sync_servers = (configs: Record<string, McpServerConfig | undefined>) =>
  serialize(async () => {
    for (const name of [...entries.keys()]) {
      if (!configs[name]?.enabled) {
        await stop_server(name);
      }
    }
    for (const [name, config] of Object.entries(configs)) {
      if (!config?.enabled) {
        continue;
      }
      const entry = entries.get(name);
      if (entry && entry.state !== "error" && entry.signature === config_signature(config)) {
        continue;
      }
      await stop_server(name);
      await start_server(name, config);
    }
  });

export const reconnect_server = (name: string, config: McpServerConfig | undefined) =>
  serialize(async () => {
    await stop_server(name);
    if (config?.enabled) {
      await start_server(name, config);
    }
  });

export const kill_all_servers_sync = () => {
  shut_down = true;
  for (const entry of entries.values()) {
    entry.state = "stopped";
    kill_tree_sync(entry.transport?.pid);
  }
  entries.clear();
};

export const server_runtime = (name: string): ServerRuntime | null => {
  const entry = entries.get(name);
  if (!entry || entry.state === "stopped") {
    return null;
  }
  return { state: entry.state, error: entry.error, tools: entry.tools, stderr_tail: entry.stderr };
};

export const ready_servers = () => [...entries.values()].filter((entry) => entry.state === "ready").map((entry) => ({ name: entry.name, tools: entry.tools }));

const progress_text = (progress: { progress: number; total?: number; message?: string }) =>
  [progress.total ? `${progress.progress}/${progress.total}` : String(progress.progress), progress.message ?? ""].filter(Boolean).join(" ");

export const call_tool = async (server: string, tool: string, args: Record<string, unknown>, options: CallOptions): Promise<McpResultText> => {
  const entry = entries.get(server);
  if (!entry || entry.state !== "ready" || !entry.client) {
    throw new Error(`MCP server ${server} is not connected.`);
  }
  const result = await entry.client.callTool({ name: tool, arguments: args }, undefined, {
    signal: options.signal,
    timeout: options.timeout_ms,
    resetTimeoutOnProgress: true,
    onprogress: (progress) => options.on_progress(progress_text(progress)),
  });
  return format_result(result);
};
