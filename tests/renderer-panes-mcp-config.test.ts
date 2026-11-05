import assert from "node:assert/strict";
import { test } from "node:test";
import { clean_server_name, config_draft, draft_config, parse_pasted_config, valid_server_name } from "../src/features/settings/panes/mcp-config.ts";

test("a Claude Desktop config yields the first server with args and env as lines", () => {
  const text = JSON.stringify({ mcpServers: { "ida pro": { command: "uvx", args: ["ida-pro-mcp", "--port", "1"], env: { A: "1", B: 2 } } } });
  assert.deepEqual(parse_pasted_config(text, ""), { name: "ida-pro", command: "uvx", args: "ida-pro-mcp\n--port\n1", env: "A=1", cwd: "" });
});

test("a VS Code servers block, a single named entry and a bare entry all parse", () => {
  assert.equal(parse_pasted_config('{ "servers": { "fs": { "command": "npx", "args": ["fs"] } } }', "")?.name, "fs");
  assert.equal(parse_pasted_config('{ "blender": { "command": "uvx", "args": ["blender-mcp"] } }', "")?.command, "uvx");
  assert.deepEqual(parse_pasted_config('{ "command": "python", "args": ["server.py"], "cwd": "D:\\\\srv" }', "mine"), {
    name: "mine",
    command: "python",
    args: "server.py",
    env: "",
    cwd: "D:\\srv",
  });
});

test("README fragments without outer braces and with trailing commas parse", () => {
  const fragment = '"cheat": { "command": "python", "args": ["ce.py",], },';
  assert.deepEqual(parse_pasted_config(fragment.replace(/,$/, ""), ""), { name: "cheat", command: "python", args: "ce.py", env: "", cwd: "" });
});

test("valid JSON with commas before closing brackets inside strings is imported unchanged", () => {
  for (const value of ["my,}password", "a,]", "x, }y", "tok,\t]end", 'q\\",}'] as const) {
    const config = { mcpServers: { demo: { command: "npx", args: ["-y", value], env: { API_KEY: value } } } };
    for (const text of [JSON.stringify(config), JSON.stringify(config, null, 2)]) {
      const draft = parse_pasted_config(text, "");
      assert.ok(draft);
      const saved = draft_config(draft);
      assert.equal(saved.env.API_KEY, value);
      assert.deepEqual(saved.args, ["-y", value]);
    }
  }
});

test("real trailing commas are removed outside strings only, escaped quotes included", () => {
  const trailing = '{"mcpServers":{"demo":{"command":"npx","args":["a","b",],},},}';
  assert.deepEqual(parse_pasted_config(trailing, ""), { name: "demo", command: "npx", args: "a\nb", env: "", cwd: "" });
  const mixed = '{ "demo": { "command": "npx", "args": ["my,}password", "a\\",]",], "env": { "K": "b,}", }, }, }';
  assert.deepEqual(draft_config(parse_pasted_config(mixed, "") ?? assert.fail("mixed input did not parse")), {
    command: "npx",
    args: ["my,}password", 'a",]'],
    cwd: "",
    env: { K: "b,}" },
    enabled: true,
  });
});

test("text that is not a server config is rejected", () => {
  assert.equal(parse_pasted_config("not json", "x"), null);
  assert.equal(parse_pasted_config('{ "a": 1, "b": 2 }', "x"), null);
  assert.equal(parse_pasted_config('{ "command": "" }', "x"), null);
  assert.equal(parse_pasted_config('{ "mcpServers": {} }', "x"), null);
  assert.equal(parse_pasted_config("[1, 2]", "x"), null);
});

test("drafts round-trip to configs with trimmed lines and KEY=value env", () => {
  const config = draft_config({ name: "x", command: " uvx ", args: "a\n\n  b c  \r\n", env: "KEY=v=1\nbad\n=nokey\n SPACED = yes ", cwd: " D:\\x " });
  assert.deepEqual(config, { command: "uvx", args: ["a", "b c"], cwd: "D:\\x", env: { KEY: "v=1", SPACED: "yes" }, enabled: true });
  assert.deepEqual(draft_config(config_draft("x", config)), config);
});

test("server names follow the main-side sanitizer", () => {
  assert.equal(clean_server_name("  my server!! "), "my-server");
  assert.equal(clean_server_name("--a--"), "a");
  assert.equal(valid_server_name("ida_pro-2"), true);
  assert.equal(valid_server_name("ida pro"), false);
  assert.equal(valid_server_name(""), false);
  assert.equal(valid_server_name("x".repeat(41)), false);
});
