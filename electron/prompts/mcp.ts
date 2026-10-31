import type { PromptSection } from "./sections.ts";

const server_lines = (names: string[]): string[] => {
  const servers = new Map<string, string[]>();
  for (const name of names) {
    const split = name.indexOf("__", "mcp__".length) + 2;
    const prefix = name.slice(0, split);
    servers.set(prefix, [...(servers.get(prefix) ?? []), name.slice(split)]);
  }
  return [...servers].map(([prefix, tools]) => `${prefix}: ${tools.join(", ")}`);
};

export const mcp = (names: string[]): PromptSection => ({
  title: "mcp",
  body: [
    "Connected MCP servers expose tools named mcp__<server>__<tool>. Their definitions are not sent up front: the list below has one line per server with its name prefix and its tool names, and a full name is the prefix followed by the tool name. Before you call a tool for the first time, load its definition with load_mcp_tools, passing the full names of every tool you need in one call, or a query when you do not know the name. Then call it with call_mcp_tool, giving its full name and its arguments. A loaded definition stays in this conversation, so load a tool again only when its definition is no longer there, for example after a compaction.",
    "A server is specialized for its own narrow domain, so use its tools only when the task genuinely needs that domain, and use your built-in tools for everything else. Dangerous MCP tools (writing or patching memory, injecting or executing code) are gated and may be denied or need the user to trust the server; do not assume they will run.",
    server_lines(names).join("\n"),
  ].join("\n\n"),
});
