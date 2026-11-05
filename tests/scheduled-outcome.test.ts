import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message, Step, TurnError } from "../shared/chat.ts";
import { final_answer, first_plain_line, is_quiet_answer, no_new_activity, notifies, quiet_answer_prefix, run_outcome, silent_end } from "../shared/scheduled.ts";
import { answered_runs, run_note, scheduled_prompt_content } from "../electron/scheduled/note.ts";

const text = (round: number, value: string, id = `t${round}`): Step => ({ id, round, kind: "text", text: value });

const tool = (round: number): Step => ({
  id: `tool${round}`,
  round,
  kind: "tool",
  index: 0,
  call_id: `c${round}`,
  name: "web_search",
  args: {},
  status: "done",
  progress: null,
  approval: null,
  view: null,
  error: null,
  result_text: "",
  started_at: null,
  ended_at: null,
});

const closed: TurnError = { kind: "app_closed", message: "closed" };

const broken: TurnError = { kind: "stream_interrupted", message: "cut" };

test("only the exact marker, optionally in one pair of backticks, is a quiet answer", () => {
  assert.equal(is_quiet_answer(no_new_activity), true);
  assert.equal(is_quiet_answer(`  \n${no_new_activity}\n `), true);
  assert.equal(is_quiet_answer(`\`${no_new_activity}\``), true);
  assert.equal(is_quiet_answer(`\` ${no_new_activity} \``), true);
  assert.equal(is_quiet_answer(`${no_new_activity}.`), false);
  assert.equal(is_quiet_answer(`${no_new_activity} since the last run`), false);
  assert.equal(is_quiet_answer(no_new_activity.toLowerCase()), false);
  assert.equal(is_quiet_answer(""), false);
});

test("a streaming answer that can still become the marker is held back, anything else shows", () => {
  for (const text of ["N", "NO_", "NO_NEW_ACT", no_new_activity, ` ${no_new_activity}\n`, "`", "`NO_NEW", `\`${no_new_activity}\``]) {
    assert.equal(quiet_answer_prefix(text), true, text);
  }
  for (const text of ["Ne", "New heat record in Mali.", `${no_new_activity}.`, `${no_new_activity} since`, "no_new"]) {
    assert.equal(quiet_answer_prefix(text), false, text);
  }
});

test("the final answer is the text of the last round, empty when that round has no text or ends in a tool call", () => {
  assert.equal(final_answer([text(0, "Looking it up."), tool(0), text(1, "Mali hit "), text(1, "48 C.", "t1b")]), "Mali hit 48 C.");
  assert.equal(final_answer([text(0, "Looking it up."), tool(0), text(1, "Mali hit "), text(1, "48 C.", "t1b"), tool(2)]), "");
  assert.equal(final_answer([text(0, "I'll check the current temperatures."), tool(0)]), "");
  assert.equal(final_answer([text(0, "I'll check the current temperatures."), tool(0), { id: "r1", round: 1, kind: "reasoning", text: "done", started_at: 1, ended_at: 2 }]), "");
  assert.equal(final_answer([tool(0)]), "");
});

test("run outcomes cover every end status", () => {
  assert.equal(run_outcome("done", null, [text(0, no_new_activity)]), "quiet");
  assert.equal(run_outcome("done", null, [text(0, "New record in Mali.")]), "new");
  assert.equal(run_outcome("done", null, [tool(0)]), "new");
  assert.equal(run_outcome("done", null, [text(0, no_new_activity), tool(0)]), "new");
  assert.equal(run_outcome("stopped", null, []), "stopped");
  assert.equal(run_outcome("interrupted", closed, []), "stopped");
  assert.equal(run_outcome("interrupted", broken, []), "failed");
  assert.equal(run_outcome("failed", broken, []), "failed");
  assert.equal(run_outcome("blocked", broken, []), "failed");
});

test("new activity always notifies, a failure only the first time in a row, quiet and stopped never", () => {
  assert.equal(notifies("new", "new"), true);
  assert.equal(notifies("failed", "quiet"), true);
  assert.equal(notifies("failed", null), true);
  assert.equal(notifies("failed", "failed"), false);
  assert.equal(notifies("quiet", "failed"), false);
  assert.equal(notifies("stopped", "new"), false);
  assert.equal(silent_end("quiet", null), true);
  assert.equal(silent_end("failed", "failed"), true);
  assert.equal(silent_end("stopped", "quiet"), false);
  assert.equal(silent_end("new", "quiet"), false);
});

test("the toast line is the first plain line without markdown syntax", () => {
  assert.equal(first_plain_line("## **New** heat record\n\nDetails"), "New heat record");
  assert.equal(first_plain_line("\n\n> - [Mali](https://example.com) reached `48 C`"), "Mali reached 48 C");
  assert.equal(first_plain_line("```\ncode\n```"), "code");
  assert.equal(first_plain_line("---\n1. _First_ warning for snake_case_name"), "First warning for snake_case_name");
  assert.equal(first_plain_line("![map](a.png) Niger"), "map Niger");
  assert.equal(first_plain_line("   \n"), "");
});

const user = (origin: "scheduled" | "user", id: string): Message => ({ id, role: "user", text: "check", attachments: [], origin, created_at: "2026-11-04T10:00:00.000Z" });

const reply = (id: string, status: "done" | "failed"): Message => ({
  id,
  role: "assistant",
  model: "a/b",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-11-04T10:00:00.000Z",
  ended_at: null,
  status,
  steps: [],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

test("only scheduled runs that finished count as earlier runs", () => {
  assert.equal(answered_runs([]), 0);
  assert.equal(answered_runs([user("scheduled", "u1"), reply("a1", "failed"), user("user", "u2"), reply("a2", "done")]), 0);
  assert.equal(answered_runs([user("scheduled", "u1"), reply("a1", "done"), user("scheduled", "u2"), reply("a2", "failed")]), 1);
});

const note = (earlier_runs: boolean, tools: string[]) =>
  run_note({ name: "Africa heat", interval: "1h", started_at: new Date(2026, 10, 4, 14, 0), earlier_runs, tool_names: new Set(tools) });

test("the run note frames the run, picks the search line by the offered tools and the block by earlier runs", () => {
  const first = note(false, ["web_search", "browser_navigate"]);
  assert.match(first, /^\[Internal app event, not a user message\. This turn is an unattended scheduled run of the task "Africa heat"\. VantheaX starts it every hour while the app is open; this run started at 2026-11-04 14:00 \(/);
  assert.match(first, /Look things up with web_search;/);
  assert.match(first, /This is the first run of this task/);
  assert.doesNotMatch(first, new RegExp(no_new_activity));
  assert.ok(first.endsWith("]"));
  const later = note(true, ["browser_navigate"]);
  assert.match(later, /Web search is not configured in this app, so look things up with the built-in browser/);
  assert.match(later, new RegExp(`your whole final answer is exactly ${no_new_activity}`));
  const bare = note(true, []);
  assert.doesNotMatch(bare, /web_search|browser_navigate/);
  assert.equal(scheduled_prompt_content("Check Mali"), "[Scheduled task run started by VantheaX on the task's schedule. The task prompt:]\n\nCheck Mali");
});
