import assert from "node:assert/strict";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ApprovalDecision, ApprovalRequest } from "../shared/approval.ts";
import type { McpServerStatus } from "../shared/ipc/extensions.ts";
import type { Settings, SettingsPatch } from "../shared/settings.ts";
import { call_tool } from "../electron/mcp/client.ts";
import { init_mcp, mcp_status, on_mcp_changed, reconnect_mcp_server, remove_server, set_settings_access, set_tool_override, shutdown_mcp, sync_mcp } from "../electron/mcp/servers.ts";
import { set_command_gate } from "../electron/tools/mcp/decide.ts";
import { mcp_tools } from "../electron/tools/mcp/tools.ts";
import type { CommandDecision } from "../electron/permissions/decide.ts";
import type { ToolContext } from "../electron/tools/types.ts";
import { answer, review_stub } from "./review-stub.ts";
import { tool_model } from "./tool-model.ts";

const gate_decision = (action: CommandDecision["action"], reason = "", note_reason = ""): CommandDecision => ({
  action,
  reason,
  record: null,
  note: note_reason ? { id: "r", source: "model", reason: note_reason, rule_source: "none", rule: "" } : null,
  grant_prefix: null,
  plan: false,
  pins: [],
  source_hash: "",
  seen: new Set(),
});

const fixture_dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "mcp");

let settings = {
  mcp_servers: { fixture: { command: process.execPath, args: [path.join(fixture_dir, "server.mjs")], cwd: fixture_dir, env: { VX_FIXTURE: "1" }, enabled: true } },
  mcp_tools: {},
  custom_instructions: "",
} as unknown as Settings;

const merge = <T extends object>(current: T, patch: Partial<T> | undefined): T =>
  patch ? (Object.fromEntries(Object.entries({ ...current, ...patch }).filter(([, value]) => value !== undefined)) as T) : current;

set_settings_access({
  get: () => settings,
  update: async (patch: SettingsPatch) => {
    settings = { ...settings, mcp_servers: merge(settings.mcp_servers, patch.mcp_servers), mcp_tools: merge(settings.mcp_tools, patch.mcp_tools) };
  },
});

const approvals: ApprovalRequest[] = [];

const context = (mode: ToolContext["mode"]): ToolContext => ({
  chat_id: "chat-life",
  turn_id: "turn",
  call_id: "call",
  project_root: fixture_dir,
  user_request: "inspect the fixture",
  mode,
  profile: "main",
  model: tool_model,
  image_fit: [],
  settings,
  signal: new AbortController().signal,
  progress: () => undefined,
  approve: async (request): Promise<ApprovalDecision> => {
    approvals.push(request);
    return { approved: false, grant: "once", feedback: "not now" };
  },
  side_model: async () => "",
  review: review_stub(Array.from({ length: 8 }, () => answer("allow"))),
  message_main: null, send_peer: null, context: () => ({ used: 0, limit: 0, compact_at: null }),
});

const status = (): McpServerStatus | undefined => mcp_status().find((entry) => entry.name === "fixture");

const changed_until = (predicate: () => boolean, timeout_ms = 10000) =>
  new Promise<void>((resolve, reject) => {
    if (predicate()) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      off();
      reject(new Error(`condition not reached, status: ${JSON.stringify(status())}`));
    }, timeout_ms);
    const off = on_mcp_changed(() => {
      if (predicate()) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });

const tool = (name: string) => {
  const found = mcp_tools().find((entry) => entry.spec.name === name);
  assert.ok(found, `${name} is offered`);
  return found;
};

after(() => {
  shutdown_mcp();
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false;
    }
    throw error;
  }
};

test("the fixture server starts, lists tiered tools and surfaces stderr", async () => {
  await init_mcp();
  const current = status();
  assert.equal(current?.state, "ready", current?.error);
  const tiers = Object.fromEntries((current?.tools ?? []).map((entry) => [entry.name, entry.tier]));
  assert.equal(tiers.read_value, "readonly");
  assert.equal(tiers.set_label, "state_change");
  assert.equal(tiers.write_memory, "dangerous");
  assert.equal(tiers.run_command, "shell_system");
  assert.match(status()?.stderr_tail ?? "", /vx fixture server ready/);
  assert.ok(mcp_tools().every((entry) => entry.profiles.join() === "main" && entry.spec.name.startsWith("mcp__fixture__")));
  assert.ok(mcp_tools().every((entry) => entry.concurrent === false), "MCP tools, readonly tier included, run one after another");
});

test("tools run, ask, and pass shell arguments through the command gate", async () => {
  const read = await tool("mcp__fixture__read_value").execute(context("auto"), { key: "k" });
  assert.equal(read.status, "done");
  assert.equal(read.text, "value of k = 42");
  assert.deepEqual(read.view, { kind: "mcp", server: "fixture", tool: "read_value", text: "value of k = 42", is_error: false });
  const write = await tool("mcp__fixture__write_memory").execute(context("full"), { address: "0x10", bytes: "90" });
  assert.equal(write.status, "denied");
  assert.deepEqual(approvals.at(-1), { kind: "mcp", server: "fixture", tool: "write_memory", tier: "dangerous", args_preview: '{\n  "address": "0x10",\n  "bytes": "90"\n}', scope: "pid=|process=|module=|address=0x10|size=", reason: "Dangerous MCP tool (memory write, patch, inject or execute), needs your approval." });
  set_command_gate(async (command) => gate_decision(command.includes("format") ? "block" : "run", "Format commands are blocked."));
  const blocked = await tool("mcp__fixture__run_command").execute(context("full"), { command: "format c:" });
  assert.equal(blocked.status, "failed");
  const allowed = await tool("mcp__fixture__run_command").execute(context("full"), { command: "echo hi" });
  assert.equal(allowed.text, "run_command is a test no-op");
  const failed = await tool("mcp__fixture__fail").execute(context("full"), {});
  assert.equal(failed.status, "failed");
  assert.equal(failed.text, "[MCP tool error] boom");
  assert.deepEqual(failed.view, { kind: "mcp", server: "fixture", tool: "fail", text: "boom", is_error: true });
  assert.equal(write.view?.kind === "mcp" && write.view.text, "");
});

test("auto asks the user when the review flags an MCP call and a no runs nothing", async () => {
  const ctx = context("auto");
  ctx.review = review_stub([answer("review", "This operation was not requested.")]);
  const count = approvals.length;
  const result = await tool("mcp__fixture__set_label").execute(ctx, { label: "denied" });
  assert.equal(result.status, "denied");
  assert.match(result.text, /^The user denied this tool call\. It did not run\.\nAutomatic review: This operation was not requested\.\nUser feedback: not now\n/);
  assert.equal(result.view?.kind === "mcp" && result.view.is_error, true);
  assert.equal(result.view?.kind === "mcp" && result.view.text, "");
  assert.equal(approvals.length, count + 1);
});

test("an MCP shell command the command policy flags asks the user instead of failing", async () => {
  set_command_gate(async () => gate_decision("ask", "", "Downloads were not requested."));
  const count = approvals.length;
  const result = await tool("mcp__fixture__run_command").execute(context("auto"), { command: "Write-Output forbidden" });
  assert.equal(result.status, "denied");
  assert.match(result.text, /^The user denied this tool call\. It did not run\.\nAutomatic review: Downloads were not requested\.\nUser feedback: not now\n/);
  assert.equal(approvals.length, count + 1);
});

test("a call past its timeout fails without dropping the server", async () => {
  const options = { signal: new AbortController().signal, timeout_ms: 200, on_progress: () => undefined };
  await assert.rejects(call_tool("fixture", "sleep", { ms: 3000 }, options), /timed out/i);
  assert.equal(status()?.state, "ready");
  assert.equal((await call_tool("fixture", "ping", {}, options)).text, "pong");
});

test("tools/list_changed refreshes the tool list", async () => {
  await call_tool("fixture", "grow", {}, { signal: new AbortController().signal, timeout_ms: 5000, on_progress: () => undefined });
  await changed_until(() => Boolean(status()?.tools.some((entry) => entry.name === "extra_tool")));
  assert.ok(mcp_tools().some((entry) => entry.spec.name === "mcp__fixture__extra_tool"));
});

test("overrides disable tools and cannot lower shell tools", async () => {
  await set_tool_override("fixture", "ping", { enabled: false });
  await set_tool_override("fixture", "write_memory", { risk: "readonly" });
  await set_tool_override("fixture", "run_command", { risk: "readonly" });
  const tools = Object.fromEntries((status()?.tools ?? []).map((entry) => [entry.name, entry]));
  assert.equal(tools.ping.enabled, false);
  assert.equal(tools.write_memory.tier, "state_change");
  assert.equal(tools.write_memory.overridden, true);
  assert.equal(tools.run_command.tier, "shell_system");
  assert.equal(mcp_tools().some((entry) => entry.spec.name === "mcp__fixture__ping"), false);
  await set_tool_override("fixture", "ping", { enabled: true });
  assert.equal(Object.hasOwn(settings.mcp_tools, "fixture/ping"), false);
});

test("reconnect replaces the process and a dying server turns into an error", async () => {
  await reconnect_mcp_server("fixture");
  assert.equal(status()?.state, "ready");
  assert.equal(status()?.tools.some((entry) => entry.name === "extra_tool"), false);
  await call_tool("fixture", "quit", {}, { signal: new AbortController().signal, timeout_ms: 5000, on_progress: () => undefined });
  await changed_until(() => status()?.state === "error");
  assert.match(status()?.error ?? "", /exited/);
  assert.equal(mcp_tools().length, 0);
  await sync_mcp();
  assert.equal(status()?.state, "ready");
});

test("a server that cannot spawn reports the error and removal stops it", async () => {
  settings = { ...settings, mcp_servers: { ...settings.mcp_servers, broken: { command: path.join(fixture_dir, "missing-binary.exe"), args: [], cwd: "", env: {}, enabled: true } } };
  await sync_mcp();
  const broken = mcp_status().find((entry) => entry.name === "broken");
  assert.equal(broken?.state, "error");
  assert.ok(broken?.error);
  await remove_server("broken");
  await remove_server("fixture");
  assert.deepEqual(mcp_status(), []);
  assert.deepEqual(Object.keys(settings.mcp_servers), []);
});

test("shutdown kills every server process before it returns and nothing starts afterwards", async () => {
  const fixture = { command: process.execPath, args: [path.join(fixture_dir, "server.mjs")], cwd: fixture_dir, env: {}, enabled: true };
  settings = { ...settings, mcp_servers: { first: fixture, second: fixture } };
  await sync_mcp();
  const pids = mcp_status().map((entry) => Number(/pid=(\d+)/.exec(entry.stderr_tail)?.[1]));
  assert.equal(pids.length, 2);
  assert.ok(pids.every((pid) => pid > 0 && alive(pid)));
  shutdown_mcp();
  assert.deepEqual(pids.map(alive), [false, false]);
  assert.deepEqual(mcp_status().map((entry) => entry.state), ["stopped", "stopped"]);
  await sync_mcp();
  assert.deepEqual(mcp_status().map((entry) => entry.state), ["stopped", "stopped"]);
});
