import assert from "node:assert/strict";
import { test } from "node:test";
import { hook_applies, matcher_error, matcher_matches, matcher_mode } from "../shared/hooks.ts";
import { tool_target } from "../electron/hooks/input.ts";

test("an empty matcher and * match every name", () => {
  assert.equal(matcher_mode(""), "all");
  assert.equal(matcher_mode(" * "), "all");
  assert.equal(matcher_matches("", "run_command"), true);
  assert.equal(matcher_matches("*", "mcp__ida-pro__decompile"), true);
});

test("exact names split on | and , with spaces trimmed", () => {
  assert.equal(matcher_mode("run_command | run_bash, write_file"), "names");
  assert.equal(matcher_matches("run_command | run_bash, write_file", "run_bash"), true);
  assert.equal(matcher_matches("run_command | run_bash, write_file", "write_file"), true);
  assert.equal(matcher_matches("run_command | run_bash, write_file", "read_file"), false);
  assert.equal(matcher_matches("run_command", "run_command_x"), false);
});

test("anything else is an unanchored, case-sensitive regular expression", () => {
  assert.equal(matcher_mode("write.*"), "pattern");
  assert.equal(matcher_matches("write.*", "write_file"), true);
  assert.equal(matcher_matches("^write_file$", "write_file"), true);
  assert.equal(matcher_matches("^write_file$", "rewrite_file"), false);
  assert.equal(matcher_matches("file$", "replace_in_file"), true);
  assert.equal(matcher_matches("Write.*", "write_file"), false);
  assert.equal(matcher_matches("Run_Command", "run_command"), false);
});

test("MCP names match by pattern, an exact server prefix matches nothing", () => {
  assert.equal(matcher_matches("mcp__ida-pro__.*", "mcp__ida-pro__decompile"), true);
  assert.equal(matcher_matches("mcp__ida-pro__.*", "mcp__cheatengine__read_memory"), false);
  assert.equal(matcher_matches("mcp__ida-pro", "mcp__ida-pro__decompile"), false);
});

test("a pattern that does not compile is reported and matches nothing", () => {
  assert.match(matcher_error("(") ?? "", /./);
  assert.equal(matcher_error("run_.*"), null);
  assert.equal(matcher_error("run_command|run_bash"), null);
  assert.equal(matcher_matches("(", "("), false);
});

test("events without a matcher ignore a stored one, disabled hooks never apply", () => {
  const base = { matcher: "nothing_matches_this", shell: "powershell" as const, command: "exit 0", timeout_s: 60, enabled: true };
  assert.equal(hook_applies({ ...base, event: "Stop" }, "Stop", null), true);
  assert.equal(hook_applies({ ...base, event: "UserPromptSubmit" }, "UserPromptSubmit", null), true);
  assert.equal(hook_applies({ ...base, event: "PreToolUse" }, "PreToolUse", "run_command"), false);
  assert.equal(hook_applies({ ...base, event: "PreToolUse", matcher: "run_command" }, "PostToolUse", "run_command"), false);
  assert.equal(hook_applies({ ...base, event: "StopFailure", matcher: "rate_limited|timeout" }, "StopFailure", "timeout"), true);
  assert.equal(hook_applies({ ...base, event: "SubagentStart", matcher: "worker" }, "SubagentStart", "explore"), false);
  assert.equal(hook_applies({ ...base, event: "Stop", enabled: false }, "Stop", null), false);
});

test("a call_mcp_tool call is matched and described as its MCP tool", () => {
  const servers = (spec_name: string) => (spec_name.startsWith("mcp__ida-pro__") ? { name: "ida-pro" } : null);
  const object = tool_target("call_mcp_tool", { name: "mcp__ida-pro__decompile", arguments: { address: "0x1400" } }, servers);
  assert.deepEqual(object, { tool_name: "mcp__ida-pro__decompile", tool_input: { address: "0x1400" }, mcp_server: { name: "ida-pro" } });
  const text = tool_target("call_mcp_tool", { name: "mcp__ida-pro__decompile", arguments: '{"address":"0x1400"}' }, servers);
  assert.equal(text.tool_name, "mcp__ida-pro__decompile");
  assert.deepEqual(text.tool_input, { address: "0x1400" });
  assert.deepEqual(tool_target("call_mcp_tool", { name: "mcp__gone__tool", arguments: {} }, servers), { tool_name: "mcp__gone__tool", tool_input: {} });
  assert.deepEqual(tool_target("read_file", { path: "a.ts" }, servers), { tool_name: "read_file", tool_input: { path: "a.ts" } });
});
