import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolStep } from "../shared/chat.ts";
import { call_shell, command_tools, is_shell_run } from "../shared/shell.ts";
import type { ToolView } from "../shared/tool-view.ts";
import { live_command } from "../src/features/tools/tool-body.ts";

const step = (name: string, status: ToolStep["status"], args: Record<string, unknown>, view: ToolView | null = null): ToolStep => ({
  id: `tool:1:${name}`,
  round: 1,
  kind: "tool",
  index: 0,
  call_id: `call-${name}`,
  name,
  args,
  status,
  progress: status === "running" ? { label: "", lines: 0, output_tail: null, can_background: true } : null,
  approval: null,
  view,
  error: null,
  result_text: "",
  started_at: 1000,
  ended_at: status === "done" ? 2500 : null,
});

test("the shell of a call follows the tool and the background shell argument", () => {
  assert.equal(call_shell("run_bash", {}), "bash");
  assert.equal(call_shell("run_command", {}), "powershell");
  assert.equal(call_shell("start_background_task", { shell: "bash" }), "bash");
  assert.equal(call_shell("start_background_task", {}), "powershell");
  assert.deepEqual([...command_tools], ["run_command", "run_bash", "start_background_task"]);
  assert.equal(is_shell_run("run_bash") && is_shell_run("run_command") && !is_shell_run("start_background_task"), true);
});

test("a running run_bash command shows the live card with the background move", () => {
  assert.equal(live_command(step("run_bash", "running", { command: "make" })), true);
  assert.equal(live_command(step("start_background_task", "running", { command: "make" })), false);
});
