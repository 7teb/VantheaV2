import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const base_tools = [
  { name: "ping", description: "health check", inputSchema: { type: "object", properties: {} } },
  { name: "read_value", description: "read a value", inputSchema: { type: "object", properties: { key: { type: "string" } } } },
  { name: "list_things", description: "list things", inputSchema: { type: "object", properties: {} } },
  { name: "set_label", description: "set a label (test no-op)", inputSchema: { type: "object", properties: { label: { type: "string" } } } },
  { name: "write_memory", description: "write bytes to an address (test no-op)", inputSchema: { type: "object", properties: { address: { type: "string" }, bytes: { type: "string" } } } },
  { name: "run_command", description: "run a shell command (test no-op, executes nothing)", inputSchema: { type: "object", properties: { command: { type: "string" } } } },
  { name: "sleep", description: "wait for ms milliseconds", inputSchema: { type: "object", properties: { ms: { type: "number" } } } },
  { name: "grow", description: "add the extra tool and announce a changed tool list", inputSchema: { type: "object", properties: {} } },
  { name: "fail", description: "return an error result", inputSchema: { type: "object", properties: {} } },
  { name: "quit", description: "exit the server process", inputSchema: { type: "object", properties: {} } },
];

const extra_tool = { name: "extra_tool", description: "appears after grow", inputSchema: { type: "object", properties: {} } };

let grown = false;

const server = new Server({ name: "vx-test-mcp", version: "1.0.0" }, { capabilities: { tools: { listChanged: true } } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: grown ? [...base_tools, extra_tool] : base_tools }));

const text = (value) => ({ content: [{ type: "text", text: value }] });

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments ?? {};
  if (name === "ping") {
    return text("pong");
  }
  if (name === "read_value") {
    return text(`value of ${args.key ?? "?"} = 42`);
  }
  if (name === "list_things") {
    return text("thing-a\nthing-b");
  }
  if (name === "set_label") {
    return text(`label ${args.label ?? ""} noted, nothing changed`);
  }
  if (name === "write_memory" || name === "run_command") {
    return text(`${name} is a test no-op`);
  }
  if (name === "sleep") {
    await new Promise((resolve) => setTimeout(resolve, Number(args.ms) || 0));
    return text("slept");
  }
  if (name === "grow") {
    grown = true;
    setTimeout(() => void server.sendToolListChanged(), 20);
    return text("grown");
  }
  if (name === "fail") {
    return { content: [{ type: "text", text: "boom" }], isError: true };
  }
  if (name === "quit") {
    setTimeout(() => process.exit(0), 20);
    return text("bye");
  }
  return { content: [{ type: "text", text: `unknown tool ${name}` }], isError: true };
});

process.stderr.write(`vx fixture server ready pid=${process.pid}\n`);
await server.connect(new StdioServerTransport());
