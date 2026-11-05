import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolStep } from "../shared/chat.ts";
import type { ToolView } from "../shared/tool-view.ts";
import { compose_sections, type SectionInput } from "../electron/prompts/sections.ts";
import { defer_mcp, is_mcp_tool } from "../electron/tools/mcp/deferred.ts";
import { define_tool, ToolArgumentError, type Tool, type ToolContext } from "../electron/tools/types.ts";
import { has_body } from "../src/features/tools/tool-body.ts";
import { tool_label, tool_meta } from "../src/features/tools/tool-meta.ts";
import { group_label } from "../src/features/tools/tool-summary.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";
import { tool_model } from "./tool-model.ts";

const t: Translate = (key, vars) => translate("en", key, vars);

const ctx = {} as ToolContext;

const calls: { name: string; args: Record<string, unknown> }[] = [];

const fake = (name: string, description: string): Tool =>
  define_tool<Record<string, unknown>>({
    spec: { name, description, parameters: { type: "object", properties: { address: { type: "string" } }, required: ["address"] } },
    profiles: ["main"],
    parse: (raw) => raw,
    run: async (...[, args]) => {
      calls.push({ name, args });
      return { status: "done", text: `${name} ran`, view: { kind: "mcp", server: "ce", tool: name.split("__").at(-1) ?? "", text: "ran", is_error: false } };
    },
  });

const builtin = define_tool<Record<string, unknown>>({
  spec: { name: "read_file", description: "read", parameters: { type: "object", properties: {} } },
  profiles: ["main"],
  parse: (raw) => raw,
  run: async () => ({ status: "done", text: "", view: null }),
});

const mcp = [
  fake("mcp__ce__aob_scan", "Scan process memory for an array of bytes."),
  fake("mcp__ce__read_memory", "Read bytes at an address of the attached process."),
  fake("mcp__ida__decompile_function", "Decompile the function at an address to pseudocode."),
];

const proxies = (tools: Tool[]) => {
  const deferred = defer_mcp(tools);
  const load = deferred.find((tool) => tool.spec.name === "load_mcp_tools");
  const call = deferred.find((tool) => tool.spec.name === "call_mcp_tool");
  assert.ok(load && call);
  return { deferred, load, call };
};

test("MCP tools leave the sent list for two proxy tools whose specs do not depend on the servers", () => {
  assert.deepEqual(defer_mcp([builtin]), [builtin]);
  const { deferred } = proxies([builtin, ...mcp]);
  assert.deepEqual(deferred.map((tool) => tool.spec.name), ["read_file", "load_mcp_tools", "call_mcp_tool"]);
  assert.equal(deferred.some(is_mcp_tool), false);
  const other = defer_mcp([builtin, fake("mcp__x__y", "other")]);
  assert.deepEqual(other.map((tool) => JSON.stringify(tool.spec)), deferred.map((tool) => JSON.stringify(tool.spec)), "connecting other servers keeps the sent specs identical");
});

test("load_mcp_tools returns the full definitions by name or query and names what it could not find", async () => {
  const { load } = proxies(mcp);
  const named = await load.execute(ctx, { names: ["mcp__ce__aob_scan", "mcp__ce__nope"] });
  assert.equal(named.status, "done");
  assert.match(named.text, /^mcp__ce__aob_scan\nScan process memory for an array of bytes\.\nArguments \(JSON schema\): \{"type":"object","properties":\{"address":\{"type":"string"\}\},"required":\["address"\]\}/);
  assert.match(named.text, /Not a connected MCP tool: mcp__ce__nope\./);
  assert.match(named.text, /Call these tools with call_mcp_tool\.$/);
  assert.deepEqual(named.view, { kind: "tool_load", names: ["mcp__ce__aob_scan"] });
  const searched = await load.execute(ctx, { query: "decompile pseudocode" });
  assert.deepEqual(searched.view, { kind: "tool_load", names: ["mcp__ida__decompile_function"] });
  const both = await load.execute(ctx, { names: ["mcp__ce__read_memory"], query: "read memory" });
  assert.deepEqual(both.view, { kind: "tool_load", names: ["mcp__ce__read_memory", "mcp__ce__aob_scan"] }, "named tools first, then further query matches");
  const nothing = await load.execute(ctx, { names: ["mcp__ce__nope"], query: "zzz" });
  assert.equal(nothing.status, "failed");
  assert.equal(nothing.text, 'Not a connected MCP tool: mcp__ce__nope. No MCP tool matches "zzz".');
  assert.throws(() => load.execute(ctx, {}), ToolArgumentError);
  assert.throws(() => load.execute(ctx, { names: "mcp__ce__aob_scan" }), /names must be an array/);
});

test("a query returns at most ten tools, best matches first", async () => {
  const many = [...Array(14).keys()].map((index) => fake(`mcp__s__scan_${index}`, index === 13 ? "scan scan memory" : "scan"));
  const { load } = proxies(many);
  const result = await load.execute(ctx, { query: "scan memory" });
  const view = result.view as Extract<ToolView, { kind: "tool_load" }>;
  assert.equal(view.names.length, 10);
  assert.equal(view.names[0], "mcp__s__scan_13");
});

test("call_mcp_tool runs the real MCP tool with its arguments, also when they arrive as a JSON string", async () => {
  const { call } = proxies(mcp);
  calls.length = 0;
  const result = await call.execute(ctx, { name: "mcp__ce__read_memory", arguments: { address: "0x10" } });
  assert.equal(result.text, "mcp__ce__read_memory ran");
  await call.execute(ctx, { name: "mcp__ce__aob_scan", arguments: '{"address":"0x20"}' });
  assert.deepEqual(calls, [
    { name: "mcp__ce__read_memory", args: { address: "0x10" } },
    { name: "mcp__ce__aob_scan", args: { address: "0x20" } },
  ]);
  const unknown = await call.execute(ctx, { name: "mcp__ce__gone", arguments: {} });
  assert.equal(unknown.status, "failed");
  assert.match(unknown.text, /mcp__ce__gone is not a connected MCP tool/);
  assert.throws(() => call.execute(ctx, { name: "mcp__ce__aob_scan", arguments: "{bad" }), /not valid JSON/);
  assert.throws(() => call.execute(ctx, { name: "mcp__ce__aob_scan", arguments: [1] }), /must be a JSON object/);
});

const section_input: SectionInput = {
  model: tool_model,
  mode: "auto",
  plan: false,
  personality: "pragmatic",
  project_root: "C:/proj",
  project_docs: [],
  listing: "",
  custom_instructions: "",
  tool_names: new Set(["load_mcp_tools", "call_mcp_tool"]),
  user_attachments: false,
  major: false,
  deferred_mcp: mcp.map((tool) => tool.spec.name),
};

test("the mcp prompt section lists every deferred tool grouped by server and explains loading", () => {
  const body = compose_sections(section_input).find((section) => section.title === "mcp")?.body ?? "";
  assert.match(body, /load its definition with load_mcp_tools/);
  assert.match(body, /call it with call_mcp_tool/);
  assert.ok(body.endsWith("mcp__ce__: aob_scan, read_memory\nmcp__ida__: decompile_function"));
  assert.equal(compose_sections({ ...section_input, deferred_mcp: [] }).some((section) => section.title === "mcp"), false);
});

const step = (name: string, view: ToolView | null, args: Record<string, unknown>, result_text: string): ToolStep => ({
  id: `tool:1:${name}`,
  round: 1,
  kind: "tool",
  index: 0,
  call_id: `call-${name}`,
  name,
  args,
  status: "done",
  progress: null,
  approval: null,
  view,
  error: null,
  result_text,
  started_at: 1000,
  ended_at: 2500,
});

test("a load shows as a closed Loaded tools row and a proxied call shows as the MCP tool itself", () => {
  const loaded = step("load_mcp_tools", { kind: "tool_load", names: ["mcp__ce__aob_scan"] }, { names: ["mcp__ce__aob_scan"] }, "mcp__ce__aob_scan\nScan memory");
  assert.equal(tool_label(t, loaded), "Loaded tools");
  assert.equal(tool_label(t, { ...loaded, status: "running", view: null, ended_at: null }), "Loading tools");
  assert.equal(has_body(t, loaded), false);
  const running = step("call_mcp_tool", null, { name: "mcp__ce__aob_scan", arguments: {} }, "");
  assert.equal(tool_label(t, { ...running, status: "running", ended_at: null }), "ce · aob_scan");
  assert.equal(tool_meta(running).category, "mcp");
  const done = step("call_mcp_tool", { kind: "mcp", server: "ce", tool: "aob_scan", text: "found", is_error: false }, { name: "mcp__ce__aob_scan", arguments: {} }, "found");
  assert.equal(tool_label(t, done), "ce · aob_scan");
  assert.equal(group_label(t, [loaded, done]), "Loaded tools, 1 MCP call");
});
