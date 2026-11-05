import assert from "node:assert/strict";
import { test } from "node:test";
import { context_status_tool, context_text, datetime_tool, local_iso, meta_tools, present_plan_tool, update_todos_tool } from "../electron/tools/meta/index.ts";
import { ToolArgumentError, type ToolContext } from "../electron/tools/types.ts";

const ctx = { signal: new AbortController().signal } as ToolContext;

test("update_todos shows the whole list with ids and statuses", async () => {
  const result = await update_todos_tool.execute(ctx, {
    todos: [
      { text: "Read the parser", status: "done" },
      { text: "  Fix   the bug ", status: "in_progress" },
      { text: "Run tests", status: "pending" },
    ],
  });
  assert.equal(
    result.text,
    "Todos updated:\n[x] Read the parser\n[~] Fix the bug\n[ ] Run tests\n2 of 3 still open. When the step in_progress is finished, mark it done right away, together with the first tool call of the next step. Before your final answer, call update_todos again: finished items done, unfinished items pending.",
  );
  assert.equal((await update_todos_tool.execute(ctx, { todos: [{ text: "Read the parser", status: "done" }] })).text, "Todos updated:\n[x] Read the parser");
  assert.deepEqual(result.view, {
    kind: "todos",
    todos: [
      { id: "todo-1", text: "Read the parser", status: "done" },
      { id: "todo-2", text: "Fix the bug", status: "in_progress" },
      { id: "todo-3", text: "Run tests", status: "pending" },
    ],
  });
  assert.equal((await update_todos_tool.execute(ctx, { todos: [] })).text, "Todo list cleared.");
});

test("update_todos rejects malformed lists precisely", async () => {
  await assert.rejects(async () => update_todos_tool.execute(ctx, {}), ToolArgumentError);
  await assert.rejects(async () => update_todos_tool.execute(ctx, { todos: [{ text: "x", done: true }] }), /todos\[0\]\.status must be one of pending, in_progress, done/);
  await assert.rejects(async () => update_todos_tool.execute(ctx, { todos: [{ text: " ", status: "done" }] }), /todos\[0\]\.text/);
  const many = [...Array(21).keys()].map((index) => ({ text: `step ${index}`, status: "pending" }));
  await assert.rejects(async () => update_todos_tool.execute(ctx, { todos: many }), /at most 20/);
});

test("present_plan returns the plan as its view", async () => {
  const result = await present_plan_tool.execute(ctx, { plan: "## Goal\nShip it\n" });
  assert.deepEqual(result.view, { kind: "plan", text: "## Goal\nShip it" });
  assert.deepEqual(present_plan_tool.profiles, ["plan"]);
});

test("datetime gives local ISO time with offset and zone name", async () => {
  assert.match(local_iso(new Date(2026, 0, 2, 3, 4, 5, 6)), /^2026-01-02T03:04:05\.006[+-]\d{2}:\d{2}$/);
  const result = await datetime_tool.execute(ctx, {});
  assert.match(result.text, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2} \([^)]+\)$/);
  assert.deepEqual(datetime_tool.profiles, ["main", "plan", "explore", "worker"]);
  assert.deepEqual(meta_tools.map((tool) => tool.spec.name), ["update_todos", "present_plan", "datetime", "context_status", "ask_user"]);
});

test("context_status reports the window, the tokens in use and the next compaction point", async () => {
  assert.equal(
    context_text({ used: 84_312, limit: 200_000, compact_at: 140_001 }),
    "Context window: 200,000 tokens. In use: 84,312 tokens (42%). Automatic compaction runs before the next model call once the context reaches 140,001 tokens (70%), 55,689 tokens from now.",
  );
  assert.match(context_text({ used: 150_000, limit: 200_000, compact_at: 140_001 }), /Automatic compaction is due: the app compacts the conversation before your next model call/);
  assert.match(context_text({ used: 9_000, limit: 0, compact_at: null }), /^In use: 9,000 tokens\. The model's context window is unknown/);
  const result = await context_status_tool.execute({ ...ctx, context: () => ({ used: 10, limit: 100, compact_at: 71 }) }, {});
  assert.equal(result.status, "done");
  assert.match(result.text, /In use: 10 tokens \(10%\)\. Automatic compaction runs .* 71 tokens \(71%\), 61 tokens from now\./);
  assert.deepEqual(context_status_tool.profiles, ["main", "plan", "explore", "worker"]);
});
