import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool as ListedTool } from "@modelcontextprotocol/sdk/types.js";
import package_json from "../../package.json" with { type: "json" };
import type { McpTier } from "../../shared/approval.ts";
import type { McpServerConfig } from "../../shared/settings.ts";
import { kill_tree_sync } from "../shell/process.ts";
import { clear_server_grants } from "./grants.ts";
import { classify_risk } from "./risk.ts";
import { build_spec_name, format_result, type McpResultText } from "./specs.ts";
import { TreeTransport } from "./transport.ts";

export type ServerState = "starting" | "ready" | "error";

export type McpToolInfo = { name: string; spec_name: string; description: string; input_schema: unknown; heuristic: McpTier; descriptor: ListedTool };

export type ServerRuntime = { state: ServerState; error: string; tools: McpToolInfo[]; stderr_tail: string };

export type CallOptions = { signal: AbortSignal; timeout_ms: number; on_progress: (message: string) => void };

type Entry = {
  name: string;
  config: McpServerConfig;
  list_revision: number;
  listing: boolean;
  state: ServerState;
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

type Binding = { config: McpServerConfig; id: string };

const desired = new Map<string, Binding>();

export const server_config_id = (name: string): string => {
  const binding = desired.get(name);
  if (!binding) {
    throw new Error(`MCP server ${name} is no longer configured.`);
  }
  return binding.id;
};

const same_launch = (left: McpServerConfig, right: McpServerConfig) => {
  if (left.command !== right.command || left.cwd !== right.cwd) {
    return false;
  }
  return isDeepStrictEqual(left.args, right.args) && isDeepStrictEqual(left.env, right.env);
};

export const observe_servers = (configs: Record<string, McpServerConfig | undefined>) => {
  for (const name of desired.keys()) {
    if (!Object.hasOwn(configs, name) || !configs[name]) {
      desired.delete(name);
      clear_server_grants(name);
    }
  }
  for (const [name, config] of Object.entries(configs)) {
    if (!config) {
      continue;
    }
    const previous = desired.get(name);
    const same = previous && same_launch(previous.config, config);
    if (same && previous.config.enabled === config.enabled) {
      continue;
    }
    desired.set(name, { config: structuredClone(config), id: same ? previous.id : randomUUID() });
    if (previous && !same) {
      clear_server_grants(name);
    }
  }
};

const inherited_env = () => Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));

const close_handles = async (entry: Entry) => {
  const { client, transport } = entry;
  entry.client = null;
  entry.transport = null;
  try {
    await transport?.close();
    await client?.close();
  } catch (error) {
    console.warn(`[mcp] closing server ${entry.name} failed: ${error_text(error)}`);
  }
};

const append_stderr = (entry: Entry, chunk: unknown) => {
  entry.stderr = `${entry.stderr}${String(chunk)}`.slice(-stderr_limit);
};

const build_tool_infos = (server: string, tools: ListedTool[], previous: McpToolInfo[]): McpToolInfo[] => {
  const by_name = new Map(previous.map((tool) => [tool.name, tool]));
  const names = new Set(tools.map((tool) => tool.name));
  const used = new Set(previous.filter((tool) => names.has(tool.name)).map((tool) => tool.spec_name));
  return tools.map((tool) => {
    const prior = by_name.get(tool.name);
    by_name.delete(tool.name);
    const spec_name = prior?.spec_name ?? build_spec_name(server, tool.name, used);
    if (prior && isDeepStrictEqual(prior.descriptor, tool)) {
      return prior;
    }
    const description = tool.description ?? "";
    return {
      name: tool.name,
      spec_name,
      descriptor: tool,
      description,
      input_schema: tool.inputSchema,
      heuristic: classify_risk({ name: tool.name, description, input_schema: tool.inputSchema }),
    };
  });
};

const list_all_tools = async (client: Client, signal: AbortSignal): Promise<ListedTool[]> => {
  const tools: ListedTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < max_tool_pages; page += 1) {
    const listed = await client.listTools(cursor ? { cursor } : undefined, { timeout: start_timeout_ms, signal });
    tools.push(...listed.tools);
    cursor = listed.nextCursor;
    if (!cursor) {
      break;
    }
  }
  return tools;
};

const is_current = (entry: Entry) => {
  if (shut_down || entries.get(entry.name) !== entry) {
    return false;
  }
  return desired.get(entry.name)?.config === entry.config;
};

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

const refresh_tools = async (entry: Entry, client: Client) => {
  const signal = AbortSignal.timeout(start_timeout_ms * max_tool_pages);
  entry.listing = true;
  try {
    while (is_current(entry)) {
      const revision = entry.list_revision;
      const tools = await list_all_tools(client, signal);
      if (!is_current(entry) || entry.client !== client) {
        return;
      }
      if (revision !== entry.list_revision) {
        continue;
      }
      entry.tools = build_tool_infos(entry.name, tools, entry.tools);
      entry.state = "ready";
      return;
    }
  } catch (error) {
    entry.tools = [];
    throw error;
  } finally {
    entry.listing = false;
  }
};

const on_tools_changed = (entry: Entry) => {
  entry.list_revision += 1;
  if (!ready(entry) || !entry.client) {
    return;
  }
  void refresh_tools(entry, entry.client)
    .catch((error: unknown) => console.warn(`[mcp] refreshing tools of ${entry.name} failed: ${error_text(error)}`))
    .then(changed);
};

const start_server = async (name: string, config: McpServerConfig) => {
  if (shut_down || desired.get(name)?.config !== config) {
    return;
  }
  const entry: Entry = { name, config, list_revision: 0, listing: false, state: "starting", error: "", client: null, transport: null, tools: [], stderr: "" };
  entries.set(name, entry);
  changed();
  const transport = new TreeTransport({
    command: config.command,
    args: config.args,
    env: { ...inherited_env(), ...config.env },
    cwd: config.cwd || undefined,
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => append_stderr(entry, chunk));
  const client = new Client(
    { name: "VantheaX", version: package_json.version },
    { capabilities: {}, listChanged: { tools: { autoRefresh: false, debounceMs: 0, onChanged: () => on_tools_changed(entry) } } },
  );
  client.onclose = () => on_closed(entry);
  client.onerror = (error) => console.warn(`[mcp] server ${name} transport error: ${error.message}`);
  entry.client = client;
  entry.transport = transport;
  try {
    await client.connect(transport, { timeout: start_timeout_ms });
    await refresh_tools(entry, client);
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
  entries.delete(name);
  await close_handles(entry);
  changed();
};

const reconcile = async (name: string, config: McpServerConfig | undefined) => {
  if (config !== desired.get(name)?.config) {
    return;
  }
  const entry = entries.get(name);
  if (entry && entry.config === config && entry.state !== "error") {
    return;
  }

  await stop_server(name);
  if (config?.enabled) {
    await start_server(name, config);
  }
};

export const sync_servers = (configs: Record<string, McpServerConfig | undefined>) => {
  observe_servers(configs);
  const snapshot = new Map(desired);
  const names = new Set([...entries.keys(), ...snapshot.keys()]);
  return serialize(async () => {
    for (const name of names) {
      await reconcile(name, snapshot.get(name)?.config);
    }
  });
};

export const reconnect_server = (name: string) => {
  const binding = desired.get(name);
  const next = binding && { ...binding, config: { ...binding.config } };
  if (next) {
    desired.set(name, next);
  }
  return serialize(() => reconcile(name, next?.config));
};

export const kill_all_servers_sync = () => {
  shut_down = true;
  for (const entry of entries.values()) {
    kill_tree_sync(entry.transport?.pid);
  }
  entries.clear();
};

export const server_runtime = (name: string): ServerRuntime | null => {
  const entry = entries.get(name);
  if (!entry || !is_current(entry)) {
    return null;
  }
  return { state: entry.state, error: entry.error, tools: entry.listing ? [] : entry.tools, stderr_tail: entry.stderr };
};

const ready = (entry: Entry) => is_current(entry) && entry.state === "ready" && !entry.listing;

export const ready_servers = () => [...entries.values()].filter(ready).map((entry) => ({ name: entry.name, tools: entry.tools }));

export const invalidate_tools = (changed: (server: string, info: McpToolInfo) => boolean) => {
  for (const entry of entries.values()) {
    for (const [index, info] of entry.tools.entries()) {
      if (changed(entry.name, info)) {
        entry.tools[index] = { ...info };
      }
    }
  }
};

export const tool_is_current = (server: string, info: McpToolInfo, config: McpServerConfig) => {
  const entry = entries.get(server);
  if (!entry || !ready(entry)) {
    return false;
  }
  return entry.tools.includes(info) && same_launch(entry.config, config);
};

const progress_text = (progress: { progress: number; total?: number; message?: string }) =>
  [progress.total ? `${progress.progress}/${progress.total}` : String(progress.progress), progress.message ?? ""].filter(Boolean).join(" ");

export const call_tool = async (server: string, tool: string, args: Record<string, unknown>, options: CallOptions): Promise<McpResultText> => {
  const entry = entries.get(server);
  if (!entry || !ready(entry) || !entry.client) {
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
