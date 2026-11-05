import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { collect_arg_strings, shell_candidates } from "../electron/mcp/risk.ts";
import { clear_mcp_chat, decide, record_grant, set_command_gate, type McpCall } from "../electron/tools/mcp/decide.ts";
import { sync_servers, server_runtime } from "../electron/mcp/client.ts";
import type { ToolContext } from "../electron/tools/types.ts";

const review = async (): Promise<never> => { throw new Error("unexpected review"); };
const context = (chat_id = "mcp-chat", mode: ToolContext["mode"] = "full") => ({ chat_id, mode } as ToolContext);
const call: McpCall = { server: "server", tool: "write_memory", tier: "dangerous", args: {}, scope: null, trusted: false };

test("shell MCP review includes strings after the old 201 argument limit", async () => {
  const args = { command: "Write-Output benign", arguments: [...Array.from({ length: 500 }, (_, index) => `filler-${index}`), "Remove-Item C:/Windows -Recurse"] };
  let seen = "";
  set_command_gate(async (command) => {
    seen = command;
    return { action: command.includes("Remove-Item") ? "block" : "run", reason: "test", record: null, note: null, grant_prefix: null, plan: false, pins: [], source_hash: "", seen: new Set() };
  });
  assert.equal((await decide({ ...call, tier: "shell_system", args }, context(), review)).kind, "block");
  assert.ok(seen.includes("filler-499"));
});

test("shell MCP review does not drop deeply nested strings", () => {
  let nested: unknown = "deep-command";
  for (let index = 0; index < 30; index += 1) nested = { args: [nested] };
  assert.ok(shell_candidates({ nested }).some((candidate) => candidate.includes("deep-command")));
  assert.deepEqual(collect_arg_strings({ a: "x", b: { c: "y" }, d: ["z", 1] }), ["x", "y", "z"]);
});

test("shell candidate traversal handles very deep JSON and shared or circular test objects", () => {
  let nested: unknown = "last-command";
  for (let index = 0; index < 10000; index += 1) nested = [nested];
  assert.deepEqual(collect_arg_strings(nested), ["last-command"]);
  const shared = { command: "shared-command" };
  const cyclic: Record<string, unknown> = { first: shared, again: shared, final: "tail-command" };
  cyclic.self = cyclic;
  assert.deepEqual(collect_arg_strings(cyclic), ["shared-command", "tail-command"]);
  const wide = Array.from({ length: 1000 }, (_, index) => `item-${index}`);
  assert.deepEqual(collect_arg_strings(wide), wide);
});

test("a full-mode dangerous session grant remains effective in its chat and server", async () => {
  clear_mcp_chat("mcp-chat");
  assert.equal((await decide(call, context(), review)).kind, "ask");
  record_grant("mcp-chat", call, "session");
  assert.equal((await decide(call, context(), review)).kind, "run");
  assert.equal((await decide({ ...call, tool: "other_write" }, context(), review)).kind, "run");
  assert.equal((await decide(call, context("different-chat"), review)).kind, "ask");
  assert.equal((await decide({ ...call, server: "different-server" }, context(), review)).kind, "ask");
  clear_mcp_chat("mcp-chat");
  assert.equal((await decide(call, context(), review)).kind, "ask");
});

test("full-mode scoped grants cover their target and once approvals do not persist", async () => {
  const scoped = { ...call, scope: "pid=4|address=0x100" };
  clear_mcp_chat("scoped-chat");
  record_grant("scoped-chat", scoped, "once");
  assert.equal((await decide(scoped, context("scoped-chat"), review)).kind, "ask");
  record_grant("scoped-chat", scoped, "chat");
  assert.equal((await decide(scoped, context("scoped-chat"), review)).kind, "run");
  assert.equal((await decide({ ...scoped, scope: "pid=4|address=0x200" }, context("scoped-chat"), review)).kind, "ask");
  assert.equal((await decide({ ...scoped, tool: "different_write" }, context("scoped-chat"), review)).kind, "ask");
  clear_mcp_chat("scoped-chat");
});

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
};

test("a failed MCP initialize cleans up its actual child process tree", { skip: process.platform !== "win32" }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-mcp-tree-"));
  const pid_file = path.join(root, "pids.json");
  const server_file = path.join(root, "server.mjs");
  const source = `import fs from 'node:fs';import {spawn} from 'node:child_process';import readline from 'node:readline';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true,detached:true});await new Promise(resolve=>child.once('spawn',resolve));fs.writeFileSync(${JSON.stringify(pid_file)},JSON.stringify([process.pid,child.pid]));const input=readline.createInterface({input:process.stdin});input.on('line',line=>{const message=JSON.parse(line);if(message.method==='initialize')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32603,message:'intentional initialize failure'}})+'\\n');});setInterval(()=>{},1000);`;
  let pids: number[] = [];
  try {
    await fs.writeFile(server_file, source);
    await sync_servers({ "broken": { command: process.execPath, args: [server_file], cwd: root, env: {}, enabled: true } });
    pids = JSON.parse(await fs.readFile(pid_file, "utf8"));
    assert.equal(server_runtime("broken")?.state, "error");
    const deadline = Date.now() + 3000;
    assert.ok(pids.every((pid) => Number.isInteger(pid) && pid > 0));
    while (pids.some(alive) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(pids.map(alive), [false, false], "MCP root and child must both exit");
  } finally {
    if (!pids.length) { try { pids = JSON.parse(await fs.readFile(pid_file, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
    for (const pid of pids) if (alive(pid)) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    await sync_servers({});
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
