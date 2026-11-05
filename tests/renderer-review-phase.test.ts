import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolProgress, ToolStep } from "../shared/chat.ts";
import { is_command_step, is_reviewing, reviewing_label } from "../src/features/tools/review-phase.ts";
import { tool_label } from "../src/features/tools/tool-meta.ts";
import { format_elapsed } from "../src/features/tools/tool-summary.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const en: Translate = (key, vars) => translate("en", key, vars);
const de: Translate = (key, vars) => translate("de", key, vars);

const review_phase: ToolProgress = { label: "", lines: null, output_tail: null, phase: "review" };

const step = (name: string, status: ToolStep["status"], progress: ToolProgress | null, args: Record<string, unknown> = {}): ToolStep => ({
  id: `tool:0:${name}`,
  round: 0,
  kind: "tool",
  index: 0,
  call_id: "c0",
  name,
  args,
  status,
  progress,
  approval: null,
  view: null,
  error: null,
  result_text: "",
  started_at: 10_000,
  ended_at: null,
});

test("the elapsed timer floors to whole seconds and stays empty under one second", () => {
  assert.equal(format_elapsed(-5), null);
  assert.equal(format_elapsed(999), null);
  assert.equal(format_elapsed(1000), "1s");
  assert.equal(format_elapsed(3999), "3s");
  assert.equal(format_elapsed(59_999), "59s");
  assert.equal(format_elapsed(60_000), "1m 0s");
  assert.equal(format_elapsed(65_400), "1m 5s");
  assert.equal(format_elapsed(3_605_000), "1h 0m 5s");
  assert.equal(format_elapsed(90_061_000), "1d 1h 1m 1s");
});

test("only a running step whose progress carries the review phase is reviewing", () => {
  assert.equal(is_reviewing(step("run_command", "running", review_phase)), true);
  assert.equal(is_reviewing(step("run_command", "running", { label: "", lines: 0, output_tail: null })), false);
  assert.equal(is_reviewing(step("run_command", "running", null)), false);
  assert.equal(is_reviewing(step("run_command", "awaiting_approval", review_phase)), false);
  assert.equal(is_reviewing(step("run_command", "cancelled", review_phase)), false);
});

test("a command under review names the command generically and counts the time since it started", () => {
  const command = step("run_command", "running", review_phase, { command: "npm test" });
  assert.equal(reviewing_label(en, command, 10_400), "Running command");
  assert.equal(reviewing_label(en, command, 13_200), "Running command for 3s");
  assert.equal(reviewing_label(de, command, 10_400), "Befehl wird ausgeführt");
  assert.equal(reviewing_label(de, command, 13_200), "Befehl läuft seit 3s");
  assert.equal(reviewing_label(en, step("start_background_task", "running", review_phase, { command: "npm run dev" }), 75_000), "Running command for 1m 5s");
});

test("the running label outside the review phase stays as before", () => {
  const command = step("run_command", "running", { label: "", lines: 0, output_tail: null }, { command: "npm test" });
  assert.equal(tool_label(en, command), "Running npm test");
  assert.equal(tool_label(de, command), "Führt npm test aus");
});

test("an MCP call under review keeps its own label", () => {
  const mcp = step("mcp__ce__write_memory", "running", review_phase, { address: "0x10" });
  assert.equal(is_command_step(mcp), false);
  assert.equal(reviewing_label(en, mcp, 20_000), tool_label(en, mcp));
});
