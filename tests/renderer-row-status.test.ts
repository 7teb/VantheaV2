import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolProgress, ToolStep, Todo } from "../shared/chat.ts";
import type { ToolView } from "../shared/tool-view.ts";
import { shown_todos } from "../src/features/composer/todos-shown.ts";
import { agent_status_label, background_status_label } from "../src/features/tools/background-status.ts";
import { has_body, opens_by_itself } from "../src/features/tools/tool-body.ts";
import { step_detail } from "../src/features/tools/tool-summary.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const t: Translate = (key, vars) => translate("en", key, vars);

const de: Translate = (key, vars) => translate("de", key, vars);

const step = (name: string, view: ToolView | null, status: ToolStep["status"] = "done", progress: ToolProgress | null = null, args: Record<string, unknown> = {}): ToolStep => ({
  id: `tool:1:${name}`,
  round: 1,
  kind: "tool",
  index: 0,
  call_id: "c1_0",
  name,
  args,
  status,
  progress,
  approval: null,
  view,
  error: null,
  result_text: "",
  started_at: 1000,
  ended_at: status === "running" ? null : 4000,
});

const grep = (total: number, extra: Partial<Extract<ToolView, { kind: "grep" }>> = {}): ToolView => ({
  kind: "grep",
  query: "needle",
  matches: [...Array(total).keys()].map((line) => ({ path: "a.ts", line, text: "needle" })),
  total,
  truncated: false,
  ...extra,
});

const background = (status: string): ToolView => ({ kind: "background", shell: "PowerShell", task_id: "bg_1", command: "npm run dev", status, output_tail: "" });

const agent = (status: string): ToolView => ({ kind: "agent", agent_id: "agent_1", run_id: "run_1", name: "Scout", status, report: "" });

test("finished grep rows show no match count, only an empty search says No matches", () => {
  assert.equal(step_detail(t, step("grep_files", grep(3))), "");
  assert.equal(step_detail(t, step("grep_files", grep(1))), "");
  assert.equal(step_detail(t, step("grep_files", grep(0))), "No matches");
  assert.equal(step_detail(de, step("grep_files", grep(0))), "Keine Treffer");
  assert.equal(step_detail(t, step("grep_files", grep(200, { truncated: true }))), "");
  assert.equal(step_detail(de, step("grep_files", grep(0, { incomplete: true }))), "");
  assert.equal(step_detail(t, step("grep_files", grep(3), "failed")), "");
});

test("an MCP row shows no detail, the failure is the row status", () => {
  const mcp = (is_error: boolean): ToolView => ({ kind: "mcp", server: "ida", tool: "decompile", text: "x", is_error });
  assert.equal(step_detail(t, step("mcp__ida__decompile", mcp(true), "failed")), "");
  assert.equal(step_detail(t, step("mcp__ida__decompile", mcp(false))), "");
});

const loading = { status: null, listed: false };

const listed = (status: string | null) => ({ status, listed: true });

test("background task rows show the live status in the UI language and never a running status frozen at call time", () => {
  const started = step("start_background_task", background("running"));
  assert.equal(step_detail(t, started, listed("running")), "Running");
  assert.equal(step_detail(t, started, listed("completed")), "Completed");
  assert.equal(step_detail(de, started, listed("failed")), "Fehlgeschlagen");
  assert.equal(step_detail(t, started, { status: "interrupted", listed: false }), "Interrupted");
  assert.equal(step_detail(t, started), "");
  assert.equal(step_detail(de, step("get_background_task", background("running")), loading), "");
  assert.equal(step_detail(t, step("cancel_background_task", background("cancelled")), loading), "Canceled");
  assert.equal(step_detail(t, step("run_command", background("running")), listed("completed")), "");
  assert.equal(background_status_label(t, "paused"), "paused");
});

test("a background task the ready task list no longer has shows its final status, a stored running one shows ended", () => {
  assert.equal(step_detail(t, step("start_background_task", background("running")), listed(null)), "Ended");
  assert.equal(step_detail(de, step("start_background_task", background("running")), listed(null)), "Beendet");
  assert.equal(step_detail(t, step("get_background_task", background("completed")), listed(null)), "Completed");
  assert.equal(step_detail(de, step("cancel_background_task", background("cancelled")), listed(null)), translate("de", "background.canceled"));
});

test("agent rows show the run status translated and follow the live run, but stay silent while it runs", () => {
  assert.equal(step_detail(t, step("deploy_agent", agent("running")), listed("running")), "");
  assert.equal(step_detail(t, step("deploy_agent", agent("running")), listed("completed")), "Completed");
  assert.equal(step_detail(t, step("deploy_agent", agent("running")), loading), "");
  assert.equal(step_detail(t, step("deploy_agent", agent("running")), listed(null)), "Ended");
  assert.equal(step_detail(de, step("get_agent_status", agent("cancelled")), loading), translate("de", "agent.status_cancelled"));
  assert.equal(agent_status_label(t, "unknown_state"), "unknown_state");
});

test("text tools, the date included, show no result next to their label", () => {
  assert.equal(step_detail(t, step("datetime", { kind: "text", text: "2026-10-15T10:00:00.000+02:00 (Europe/Berlin)" })), "");
  assert.equal(step_detail(t, step("list_agents", { kind: "text", text: "Agents" })), "");
  assert.equal(step_detail(t, step("grep_files", null, "running", { label: "12 matches", lines: null, output_tail: null })), "");
});

test("a running command row in the main chat never opens by itself, other rows still do", () => {
  const spawned: ToolProgress = { label: "", lines: 0, output_tail: "1 passing", can_background: true };
  const command = step("run_command", null, "running", spawned, { command: "npm test" });
  assert.equal(has_body(t, command), true);
  assert.equal(opens_by_itself(command, true), false);
  assert.equal(opens_by_itself(command, false), true);
  assert.equal(opens_by_itself(step("run_command", null, "running", { label: "", lines: null, output_tail: null, phase: "review" }), false), false);
  assert.equal(opens_by_itself(step("web_search", null, "running"), true), true);
  assert.equal(opens_by_itself(step("run_bash", null, "running", spawned, { command: "make" }), true), false);
  assert.equal(step_detail(t, step("run_bash", background("running")), listed("completed")), "");
});

const todo = (id: string, status: Todo["status"]): Todo => ({ id, text: id, status });

test("the todo panel keeps an open list, plays out a finished one and forgets it after the exit", () => {
  const open = [todo("a", "done"), todo("b", "in_progress")];
  const shown = shown_todos(open, null);
  assert.deepEqual(shown, { todos: open, leaving: false });
  assert.equal(shown_todos(open, shown), shown);
  const closed = [todo("a", "done"), todo("b", "done")];
  const leaving = shown_todos(closed, shown);
  assert.deepEqual(leaving, { todos: closed, leaving: true });
  assert.equal(shown_todos(closed, leaving), leaving);
  assert.equal(shown_todos(closed, null), null);
  const cleared = shown_todos([], shown);
  assert.deepEqual(cleared, { todos: open, leaving: true });
  assert.equal(shown_todos(null, null), null);
  const reopened = [todo("c", "pending")];
  assert.deepEqual(shown_todos(reopened, leaving), { todos: reopened, leaving: false });
});
