import assert from "node:assert/strict";
import path from "node:path";
import { before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import type { Tool } from "../electron/tools/types.ts";
import { make_tool } from "./turn-loop-harness.ts";

const electron_stub = "module.exports = { app: { getAppPath: () => process.cwd(), getPath: () => process.cwd() } };";

const bundle_url = pathToFileURL(path.join(process.cwd(), "tests", "tools-concurrent.bundle.js")).href;

const main_stubs: Plugin = {
  name: "main-stubs",
  setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: electron_stub, loader: "js" }));
  },
};

let main: { find_tool: (name: string) => Tool | null; defer_mcp: (tools: Tool[]) => Tool[] };

before(async () => {
  const entry = ['export { find_tool } from "./electron/tools/registry.ts";', 'export { defer_mcp } from "./electron/tools/mcp/deferred.ts";'].join("\n");
  const result = await build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [main_stubs],
    define: { "import.meta.url": JSON.stringify(bundle_url) },
    banner: { js: `import { createRequire as bundle_require } from "node:module"; const require = bundle_require(${JSON.stringify(bundle_url)});` },
    logLevel: "silent",
  });
  main = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
});

const concurrent = [
  "read_file",
  "list_files",
  "grep_files",
  "get_file_outline",
  "view_image",
  "analyze_image",
  "read_attachment",
  "web_search",
  "generate_image",
  "deploy_agent",
  "continue_agent",
  "get_agent_status",
  "list_agents",
  "get_background_task",
  "list_memories",
  "read_skill",
  "list_models",
  "datetime",
  "context_status",
];

const browser = [
  "browser_tabs",
  "browser_tab",
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_key",
  "browser_scroll",
  "browser_wait",
  "browser_screenshot",
  "browser_click_point",
  "browser_console",
  "browser_eval",
  "browser_visual_analyze",
  "browser_visual_click",
];

const sequential = [
  "write_file",
  "replace_in_file",
  "run_command",
  "run_bash",
  "start_background_task",
  "cancel_background_task",
  ...browser,
  "check_page",
  "add_mcp_server",
  "remember",
  "forget",
  "install_skill",
  "message_agent",
  "cancel_agent",
  "message_main_agent",
  "message_peer",
  "run_workflow",
  "stop_workflow",
  "update_todos",
  "ask_user",
  "present_plan",
  "present_images",
  "show_images",
  "visualize",
];

const registered = (name: string): Tool => {
  const tool = main.find_tool(name);
  assert.ok(tool, `${name} is not in the registry`);
  return tool;
};

test("read-only lookups, image generation and agent starts are marked concurrent", () => {
  for (const name of concurrent) {
    assert.equal(registered(name).concurrent, true, name);
  }
});

test("edits, commands, browser steps, state changes and user-facing output stay sequential", () => {
  for (const name of sequential) {
    assert.equal(registered(name).concurrent, false, name);
  }
});

test("load_mcp_tools is concurrent while call_mcp_tool is not", () => {
  const mcp = make_tool("mcp__s__t", async () => ({ status: "done", text: "", view: null }));
  const deferred = main.defer_mcp([registered("read_file"), mcp]);
  const by_name = new Map(deferred.map((tool) => [tool.spec.name, tool]));
  assert.equal(by_name.get("load_mcp_tools")?.concurrent, true);
  assert.equal(by_name.get("call_mcp_tool")?.concurrent, false);
});
