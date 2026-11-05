import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolProgress, ToolStep } from "../shared/chat.ts";
import type { ToolView } from "../shared/tool-view.ts";
import { background_status_label } from "../src/features/tools/background-status.ts";
import { has_body, live_command, offers_background } from "../src/features/tools/tool-body.ts";
import { tool_label } from "../src/features/tools/tool-meta.ts";
import { step_detail } from "../src/features/tools/tool-summary.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const t: Translate = (key, vars) => translate("en", key, vars);

const de: Translate = (key, vars) => translate("de", key, vars);

const command_step = (command: string, status: ToolStep["status"], progress: ToolProgress | null, view: ToolView | null = null): ToolStep => ({
  id: "tool:1:run_command",
  round: 1,
  kind: "tool",
  index: 0,
  call_id: "c1_0",
  name: "run_command",
  args: { command },
  status,
  progress,
  approval: null,
  view,
  error: null,
  result_text: "",
  started_at: 1000,
  ended_at: status === "running" ? null : 4000,
});

const spawned = (extra: Partial<ToolProgress> = {}): ToolProgress => ({ label: "", lines: 0, output_tail: null, ...extra });

const review: ToolProgress = { label: "", lines: null, output_tail: null, phase: "review" };

const moved_view = (command: string): ToolView => ({ kind: "background", shell: "PowerShell", task_id: "bg_1", command, status: "running", output_tail: "" });

test("a silent running command in the main chat expands to its card with the move button", () => {
  const silent = command_step("npm test", "running", spawned({ can_background: true }));
  assert.equal(offers_background(silent), true);
  assert.equal(live_command(silent), true);
  assert.equal(has_body(t, silent), true);
});

test("a sub-agent's running command expands only when its card shows more than the row", () => {
  assert.equal(has_body(t, command_step("npm test", "running", spawned())), false);
  assert.equal(has_body(t, command_step("npm test", "running", spawned({ output_tail: "1 passing" }))), true);
  const long_command = command_step("npm run build\nnpm test", "running", spawned());
  assert.equal(offers_background(long_command), false);
  assert.equal(live_command(long_command), true);
  assert.equal(has_body(t, long_command), true);
});

test("no move button before the process starts, during the review or after the command ended", () => {
  assert.equal(has_body(t, command_step("npm test", "running", null)), false);
  assert.equal(live_command(command_step("npm run build\nnpm test", "running", null)), false);
  const reviewing = command_step("npm test", "running", review);
  assert.equal(live_command(reviewing), false);
  assert.equal(offers_background(reviewing), false);
  const cancelled = command_step("npm test", "cancelled", spawned({ can_background: true }));
  assert.equal(offers_background(cancelled), false);
  assert.equal(has_body(t, cancelled), false);
  assert.equal(offers_background(command_step("npm test", "awaiting_approval", null)), false);
});

test("a command moved to the background says so in its row and opens the task card", () => {
  const moved = command_step("npm test", "done", null, moved_view("npm test"));
  assert.equal(tool_label(t, moved), "Moved npm test to the background");
  assert.equal(tool_label(de, moved), "npm test in den Hintergrund verschoben");
  assert.equal(step_detail(t, moved), "");
  assert.equal(has_body(t, moved), true);
  const long = command_step("npm run build\nnpm test", "done", null, moved_view("npm run build\nnpm test"));
  assert.equal(tool_label(t, long), "Moved PowerShell to the background");
  assert.equal(tool_label(t, command_step("npm test", "running", spawned({ can_background: true }))), "Running npm test");
});

test("background task status reads in the UI language and keeps unknown stored values", () => {
  assert.equal(background_status_label(t, "running"), "Running");
  assert.equal(background_status_label(de, "completed"), "Abgeschlossen");
  assert.equal(background_status_label(t, "cancelled"), "Canceled");
  assert.equal(background_status_label(t, "paused"), "paused");
});
