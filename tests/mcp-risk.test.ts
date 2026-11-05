import assert from "node:assert/strict";
import { test } from "node:test";
import { apply_override, classify_risk, collect_arg_strings, extract_command_arg, shell_candidates, target_scope } from "../electron/mcp/risk.ts";

const tool = (name: string, description = "", properties: Record<string, unknown> | null = null) => ({
  name,
  description,
  input_schema: properties ? { type: "object", properties } : null,
});

test("read and inspection tools are readonly", () => {
  for (const name of ["read_memory", "list_functions", "disassemble", "get_xrefs_to", "aob_scan", "decompile_function", "get_metadata", "enum_modules"]) {
    assert.equal(classify_risk(tool(name)), "readonly", name);
  }
});

test("annotation and bookkeeping tools are state changes", () => {
  for (const name of ["rename_function", "set_comment", "set_breakpoint", "save_table", "register_symbol", "declare_c_type", "frobnicate"]) {
    assert.equal(classify_risk(tool(name)), "state_change", name);
  }
});

test("memory writes, injection and execution are dangerous", () => {
  for (const name of ["write_memory", "write_process_memory_cr3", "inject_dll", "auto_assemble", "execute_code", "create_thread", "patch_address_assembles", "allocate_kernel_memory", "set_memory_protection", "dbk_write"]) {
    assert.equal(classify_risk(tool(name)), "dangerous", name);
  }
  assert.equal(classify_risk(tool("apply_change", "this writes memory at address")), "dangerous");
  assert.equal(classify_risk(tool("read_and_apply", "", { bytes: {}, address: {} })), "dangerous");
});

test("process and shell tools are shell_system", () => {
  for (const name of ["run_command", "shell_execute", "create_process"]) {
    assert.equal(classify_risk(tool(name)), "shell_system", name);
  }
  assert.equal(classify_risk(tool("do_thing", "", { command: {} })), "shell_system");
  assert.equal(classify_risk(tool("run_program", "run an executable", { path: {} })), "shell_system");
  assert.equal(classify_risk(tool("read_file", "read a file", { path: {} })), "readonly");
});

test("overrides never lower shell_system and clamp dangerous to state_change", () => {
  assert.equal(apply_override("dangerous", "state_change"), "state_change");
  assert.equal(apply_override("dangerous", "readonly"), "state_change");
  assert.equal(apply_override("shell_system", "readonly"), "shell_system");
  assert.equal(apply_override("shell_system", "state_change"), "shell_system");
  assert.equal(apply_override("shell_system", "dangerous"), "shell_system");
  assert.equal(apply_override("readonly", "shell_system"), "shell_system");
  assert.equal(apply_override("readonly", "dangerous"), "dangerous");
  assert.equal(apply_override("state_change", "readonly"), "readonly");
  assert.equal(apply_override("dangerous", null), "dangerous");
});

test("command arguments are found under the usual keys", () => {
  assert.equal(extract_command_arg({ command: "format c:" }), "format c:");
  assert.equal(extract_command_arg({ Script: "rm x" }), "rm x");
  assert.equal(extract_command_arg({ argv: ["a"], cmd: ["git", "status"] }), "git status");
  assert.equal(extract_command_arg({ value: 5, address: "0x10" }), null);
});

test("argument strings are collected from nested values", () => {
  assert.deepEqual(collect_arg_strings({ a: "x", b: { c: "y" }, d: ["z", 1] }), ["x", "y", "z"]);
});

test("shell candidates cover the command, every string and the joined argv", () => {
  assert.deepEqual(shell_candidates({ command: "git status" }), ["git status"]);
  assert.deepEqual(shell_candidates({ arguments: ["format", "c:"] }), ["format c:", "format", "c:"]);
  assert.deepEqual(shell_candidates({ code: "x", opts: { cmd: "Remove-Item C:\\Windows -Recurse" } }), ["x Remove-Item C:\\Windows -Recurse", "x", "Remove-Item C:\\Windows -Recurse"]);
  assert.deepEqual(shell_candidates({ count: 3 }), []);
});

test("target scopes identify the same process region", () => {
  const first = target_scope({ pid: 1234, address: "0x401000", size: 64 });
  assert.equal(first, "pid=1234|process=|module=|address=0x401000|size=64");
  assert.equal(target_scope({ pid: 1234, address: "0x401000", size: 64 }), first);
  assert.notEqual(target_scope({ pid: 1234, address: "0x402000", size: 64 }), first);
  assert.equal(target_scope({ processName: "Game.EXE" }), "pid=|process=game.exe|module=|address=|size=");
  assert.equal(target_scope({ foo: 1 }), null);
});
