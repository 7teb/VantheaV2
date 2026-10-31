import { error_text } from "../../storage/coerce.ts";
import { require_string } from "../browser/common.ts";
import { define_tool, ToolArgumentError, type Tool, type ToolResult } from "../types.ts";

const max_query_matches = 10;

export const is_mcp_tool = (tool: Tool): boolean => tool.spec.name.startsWith("mcp__");

const failed = (text: string): ToolResult => ({ status: "failed", text, view: null });

const definition_text = (tool: Tool) => [tool.spec.name, tool.spec.description, `Arguments (JSON schema): ${JSON.stringify(tool.spec.parameters)}`].join("\n");

const search = (tools: Tool[], query: string): Tool[] => {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1);
  return tools
    .map((tool) => {
      const name = tool.spec.name.toLowerCase();
      const description = tool.spec.description.toLowerCase();
      return { tool, score: words.reduce((sum, word) => sum + (name.includes(word) ? 2 : 0) + (description.includes(word) ? 1 : 0), 0) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max_query_matches)
    .map((entry) => entry.tool);
};

type LoadArgs = { names: string[]; query: string };

const parse_load = (raw: Record<string, unknown>): LoadArgs => {
  const names = raw.names ?? [];
  if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) {
    throw new ToolArgumentError("names must be an array of full MCP tool names");
  }
  const query = raw.query ?? "";
  if (typeof query !== "string") {
    throw new ToolArgumentError("query must be a string");
  }
  const picked = [...new Set(names.map((name: string) => name.trim()).filter(Boolean))];
  if (!picked.length && !query.trim()) {
    throw new ToolArgumentError("pass names, query or both");
  }
  return { names: picked, query: query.trim() };
};

const load_tool = (mcp: Tool[]): Tool => {
  const by_name = new Map(mcp.map((tool) => [tool.spec.name, tool]));
  return define_tool<LoadArgs>({
    spec: {
      name: "load_mcp_tools",
      description:
        "Load the full definitions (description and argument schema) of MCP tools, by their full names from the mcp section of your instructions or by a query searched in their names and descriptions (at most 10 matches). Call a loaded tool with call_mcp_tool. A definition stays in this conversation once loaded, so load each tool once.",
      parameters: {
        type: "object",
        properties: {
          names: { type: "array", items: { type: "string" }, description: "Full tool names, for example mcp__server__tool. Load every tool you need in one call." },
          query: { type: "string", description: "Words to search for in tool names and descriptions." },
        },
        additionalProperties: false,
      },
    },
    profiles: ["main"],
    concurrent: true,
    parse: parse_load,
    run: async (...[, args]) => {
      const unknown = args.names.filter((name) => !by_name.has(name));
      const found = args.query ? search(mcp, args.query) : [];
      const loaded = [...new Set([...args.names.flatMap((name) => by_name.get(name) ?? []), ...found])];
      const notes = [
        ...(unknown.length ? [`Not a connected MCP tool: ${unknown.join(", ")}.`] : []),
        ...(args.query && !found.length ? [`No MCP tool matches "${args.query}".`] : []),
      ];
      if (!loaded.length) {
        return failed(notes.join(" "));
      }
      const text = [...loaded.map(definition_text), ...notes, "Call these tools with call_mcp_tool."].join("\n\n");
      return { status: "done", text, view: { kind: "tool_load", names: loaded.map((tool) => tool.spec.name) } };
    },
  });
};

type CallArgs = { name: string; arguments: Record<string, unknown> };

const tool_arguments = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new ToolArgumentError(`arguments is a string that is not valid JSON: ${error_text(error)}`);
  }
};

const parse_call = (raw: Record<string, unknown>): CallArgs => {
  const value = tool_arguments(raw.arguments ?? {});
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolArgumentError("arguments must be a JSON object with the tool's arguments");
  }
  return { name: require_string(raw, "name"), arguments: value as Record<string, unknown> };
};

const call_tool = (mcp: Tool[]): Tool => {
  const by_name = new Map(mcp.map((tool) => [tool.spec.name, tool]));
  return define_tool<CallArgs>({
    spec: {
      name: "call_mcp_tool",
      description: "Call an MCP tool by its full name, with its arguments as a JSON object that follows the schema load_mcp_tools returned for it.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Full tool name, for example mcp__server__tool." },
          arguments: { type: "object", description: "The tool's arguments." },
        },
        required: ["name", "arguments"],
        additionalProperties: false,
      },
    },
    profiles: ["main"],
    parse: parse_call,
    run: async (ctx, args) => {
      const tool = by_name.get(args.name);
      if (!tool) {
        return failed(`${args.name} is not a connected MCP tool; the mcp section of your instructions lists the connected ones`);
      }
      return tool.execute(ctx, args.arguments);
    },
  });
};

export const defer_mcp = (tools: Tool[]): Tool[] => {
  const mcp = tools.filter(is_mcp_tool);
  return mcp.length ? [...tools.filter((tool) => !is_mcp_tool(tool)), load_tool(mcp), call_tool(mcp)] : tools;
};
