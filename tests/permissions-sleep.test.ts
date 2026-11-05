import assert from "node:assert/strict";
import { test } from "node:test";
import { command_sleep_reason, rejected_text, sleep_reason } from "../electron/permissions/sleep.ts";
import { mcp_command_gate } from "../electron/permissions/mcp-gate.ts";
import { decide, set_command_gate } from "../electron/tools/mcp/decide.ts";
import type { ToolContext } from "../electron/tools/types.ts";
import { review_stub } from "./review-stub.ts";
import { tool_model } from "./tool-model.ts";
import { set_storage_root } from "../electron/storage/paths.ts";

set_storage_root(process.cwd());

const context = (mode: ToolContext["mode"]): ToolContext => ({
  chat_id: "sleep-policy", turn_id: "turn", call_id: "call", project_root: "", user_request: "Inspect the code.",
  mode, profile: "main", model: tool_model, image_fit: [], settings: {} as ToolContext["settings"], signal: new AbortController().signal,
  progress: () => undefined, approve: async () => { throw new Error("No approval expected."); },
  side_model: async () => { throw new Error("No classifier expected."); }, review: review_stub(), message_main: null, send_peer: null, context: () => ({ used: 0, limit: 0, compact_at: null }),
});

test("normal PowerShell delays are allowed even while agents run", () => {
  const commands = [
    "Start-Sleep -Milliseconds 1; Write-Output 'process startup'",
    "sleep 60",
    "Microsoft.PowerShell.Utility\\Start-Sleep -Milliseconds 500",
    "& 'Start-Sleep' -Seconds 60",
    "if ($true) { Start-Sleep -Seconds 60 }",
    "powershell -Command 'Start-Sleep -Seconds 60'",
    "Write-Output \"$(Start-Sleep -Seconds 60)\"",
    "Start-S" + String.fromCharCode(96) + "leep -Seconds 60",
  ];
  for (const command of commands) {
    assert.equal(sleep_reason(command, false), null);
    assert.equal(sleep_reason(command, true), null);
  }
});

test("literal sleep text and read commands are not treated as sleep execution", () => {
  for (const command of [
    "Write-Output \'Start-Sleep -Seconds 60\'",
    "rg \'Start-Sleep\' .",
    "Get-Command Start-Sleep",
    "Get-Content agent-report.txt",
  ]) assert.equal(sleep_reason(command, true), null);
});

test("necessary delays for other tasks may use Python or a bounded alternative", () => {
  for (const command of [
    "python -c \"import time; time.sleep(0.1); print(\'retry backoff\')\"",
    "node -e \"setTimeout(() => console.log(\'server startup\'), 100)\"",
    "[System.Threading.Thread]::Sleep(100)",
  ]) assert.equal(sleep_reason(command, true), null);
});

test("explicit waits for active agents are rejected across languages", () => {
  for (const command of [
    "Start-Sleep -Seconds 60; Write-Output 'waiting for agents'",
    "sleep 60; Write-Output 'waiting for agent reports'",
    "python -c \"import time; time.sleep(60); print(\'waiting for agents\')\"",
    "node -e \"setTimeout(() => console.log(\'waiting for reviewers\'), 60000)\"",
    "cmd /c timeout /t 60 & echo waiting for agent reports",
    "[System.Threading.Thread]::Sleep(60000); Write-Output \'waiting for agents\'",
  ]) assert.match(sleep_reason(command, true) ?? "", /Do not use sleep commands to wait for agents/);
});

test("alternate-delay checks do not invent agents that are absent from the chat", () => {
  const command = "python -c \"import time; time.sleep(0.1); print(\'waiting for agents\')\"";
  assert.equal(sleep_reason(command, false), null);
  assert.equal(command_sleep_reason(context("full"), command), null);
});

test("rejected calls use the requested bracketed reason", () => {
  assert.equal(rejected_text("Use the harness wait."), "Tool call rejected [Use the harness wait.]");
});

test("normal shell-like MCP delays follow the regular command gate", async () => {
  const ctx = context("full");
  const gate = await mcp_command_gate("Start-Sleep -Seconds 60", ctx, []);
  assert.equal(gate.action, "run");
  set_command_gate(mcp_command_gate);
  const outcome = await decide({ server: "test", tool: "run_command", tier: "shell_system", args: { command: "sleep 60" }, scope: null, trusted: true }, ctx,
    async () => { throw new Error("No overseer expected."); });
  assert.equal(outcome.kind, "run");
});
