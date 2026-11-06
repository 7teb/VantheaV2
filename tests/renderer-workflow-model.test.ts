import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Message, NoticeStep, UserMessage } from "../shared/chat.ts";
import { parse_workflow_notice, split_workflow_notices, workflow_notice_text } from "../shared/workflow-notes.ts";
import { build_blocks } from "../src/features/chat/assistant-blocks.ts";
import { turn_layout } from "../src/features/chat/origin-steps.ts";
import { member_facts, turn_shape } from "../src/features/chat/turn-shape.ts";
import { group_head } from "../src/features/tools/group-head.ts";
import { tool_label, tool_meta } from "../src/features/tools/tool-meta.ts";
import { group_label } from "../src/features/tools/tool-summary.ts";
import {
  agent_hint,
  agent_meta,
  agent_ms,
  agent_time,
  agent_transcript,
  agents_line,
  can_skip,
  counts_line,
  phase_groups,
  role_label,
  row_tone,
  run_span,
  shown_error,
  split_workflow_approval,
  started_workflow,
  workflow_label,
  workflow_view,
} from "../src/features/tools/workflow-model.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";
import { agent_entry, at, run_id, summary_of, tool_step, workflow_tool_view } from "./workflow-ui-kit.ts";

const t: Translate = (key, vars) => translate("en", key, vars);
const de: Translate = (key, vars) => translate("de", key, vars);

test("only a run_workflow step with a workflow view counts as a started workflow", () => {
  const view = workflow_tool_view();
  assert.deepEqual(workflow_view(tool_step("run_workflow", view)), view);
  assert.equal(started_workflow(tool_step("run_workflow", view)), run_id);
  assert.equal(started_workflow(tool_step("stop_workflow", view)), null);
  assert.equal(started_workflow(tool_step("run_workflow", null, "denied")), null);
  assert.equal(started_workflow(tool_step("run_workflow", { kind: "text", text: "x" })), null);
});

test("workflow labels follow the live status in both languages", () => {
  assert.equal(workflow_label(t, "review", "running"), "Running workflow review");
  assert.equal(workflow_label(t, "review", "completed"), "Ran workflow review");
  assert.equal(workflow_label(t, "review", "failed"), "Workflow review failed");
  assert.equal(workflow_label(t, "review", "stopped"), "Stopped workflow review");
  assert.equal(workflow_label(t, "review", "interrupted"), "Workflow review interrupted");
  assert.equal(workflow_label(t, "review", null), "Ran workflow review");
  assert.equal(workflow_label(de, "review", "running"), "Workflow review läuft");
  assert.deepEqual(
    (["running", "completed", "failed", "stopped", "interrupted", null] as const).map(row_tone),
    ["running", "done", "failed", "cancelled", "failed", "done"],
  );
});

test("tool rows name the workflow from the view, the approval, the args or the script", () => {
  assert.equal(tool_meta(tool_step("run_workflow", null)).icon, "workflow");
  assert.equal(tool_meta(tool_step("run_workflow", null)).category, "workflows");
  assert.equal(tool_label(t, tool_step("run_workflow", workflow_tool_view())), "Ran workflow review-changes");
  assert.equal(tool_label(t, tool_step("run_workflow", null, "running", { name: "nightly" })), "Starting workflow nightly");
  const script = "// review\nexport const meta = {\n  name: 'find-flaky',\n  description: 'x',\n}\nreturn 1";
  assert.equal(tool_label(t, tool_step("run_workflow", null, "running", { script })), "Starting workflow find-flaky");
  assert.equal(tool_label(t, tool_step("run_workflow", null, "running", { script_path: "D:/p/.vantheax/workflows/audit.js" })), "Starting workflow audit.js");
  assert.equal(tool_label(t, tool_step("run_workflow", null, "running", { script: "return 1" })), "Starting workflow");
  const waiting = {
    ...tool_step("run_workflow", null, "awaiting_approval", { script }),
    approval: { kind: "agent_message" as const, tool: "run_workflow" as const, to_name: "from-approval", to_id: null, about: "d", text: script },
  };
  assert.equal(tool_label(t, waiting), "Starting workflow from-approval");
  assert.equal(tool_label(t, tool_step("run_workflow", null, "drafting", { script })), "Preparing tool call");
  assert.equal(tool_label(t, tool_step("stop_workflow", null, "running", { run_id })), `Stopping workflow ${run_id}`);
  assert.equal(tool_label(t, tool_step("stop_workflow", workflow_tool_view("stopped"))), "Stopped workflow review-changes");
  assert.equal(tool_label(t, tool_step("run_workflow", null, "denied", { script })), "Denied find-flaky");
});

test("groups count started and stopped workflows in their own words", () => {
  const steps = [tool_step("run_workflow", workflow_tool_view(), "done", {}, "a"), tool_step("stop_workflow", workflow_tool_view("stopped"), "done", { run_id }, "b"), tool_step("run_workflow", workflow_tool_view(), "done", {}, "c")];
  assert.equal(group_label(t, steps), "Ran workflows, stopped a workflow");
  assert.equal(group_label(de, [steps[0]!]), "Einen Workflow ausgeführt");
});

test("a group head shows a running workflow once nothing else streams, with the workflow start time", () => {
  const read = tool_step("read_file", null, "done", { path: "a.ts" }, "r");
  const steps = [read, tool_step("run_workflow", workflow_tool_view(), "done", {}, "w")];
  const live = summary_of("running", []);
  assert.deepEqual(group_head(t, steps, false, false, live), { kind: "workflow", key: "workflow:Running workflow review-changes", label: "Running workflow review-changes", started_at: Date.parse(at(0)) });
  assert.deepEqual(group_head(t, steps, false, false, null), { kind: "done", key: "done:Read a file, ran a workflow:0", label: "Read a file, ran a workflow", denied: 0 });
  const streaming = [read, tool_step("run_command", null, "running", { command: "npm test" }, "c")];
  assert.deepEqual(group_head(t, streaming, true, false, live), { kind: "tool", key: "tool:Running npm test", label: "Running npm test" });
});

test("agents group by phase in call order, ungrouped agents keep their place", () => {
  const summary = summary_of("running", [
    agent_entry(3, "running", { phase: "Verify" }),
    agent_entry(0, "completed", { phase: "Review" }),
    agent_entry(1, "running", { phase: null }),
    agent_entry(2, "failed", { phase: "Review" }),
    agent_entry(4, "starting", { phase: "▸ child: Review" }),
  ], { phases: [{ title: "Review", detail: "one agent per dimension", model: "" }, { title: "Verify", detail: "", model: "" }] });
  const groups = phase_groups(summary);
  assert.deepEqual(groups.map((group) => [group.key, group.title, group.detail, group.agents.map((agent) => agent.index), group.done]), [
    ["phase:Review", "Review", "one agent per dimension", [0, 2], 2],
    ["none", null, "", [1], 0],
    ["phase:Verify", "Verify", "", [3], 0],
    ["phase:▸ child: Review", "▸ child: Review", "", [4], 0],
  ]);
  assert.deepEqual(phase_groups(summary_of("running", [])), []);
});

test("row and footer counts say how far the run is and what happened", () => {
  const agents = [agent_entry(0, "completed"), agent_entry(1, "running"), agent_entry(2, "cached"), agent_entry(3, "failed"), agent_entry(4, "starting"), agent_entry(5, "skipped")];
  const running = summary_of("running", agents);
  assert.equal(agents_line(t, running), "4/6 agents");
  assert.equal(agents_line(t, summary_of("completed", [agent_entry(0, "completed")])), "1 agent");
  assert.equal(agents_line(t, summary_of("stopped", agents)), "6 agents");
  assert.equal(agents_line(t, summary_of("running", [])), "");
  assert.equal(counts_line(t, running.counts), "2 running, 1 completed, 1 cached, 1 skipped, 1 failed");
  assert.equal(counts_line(de, running.counts), "2 laufend, 1 abgeschlossen, 1 aus dem Cache, 1 übersprungen, 1 fehlgeschlagen");
  assert.equal(counts_line(t, summary_of("running", []).counts), "");
  assert.equal(run_span(summary_of("completed", [])), 312_000);
  assert.equal(run_span(summary_of("running", [])), null);
});

test("agent rows show role, the status word only where the icon is not enough, and their time", () => {
  const now = Date.parse(at(75));
  assert.equal(agent_meta(t, agent_entry(0, "running"), now, false), "Worker · 1m 15s");
  assert.equal(agent_meta(t, agent_entry(0, "running", { role: "explore" }), now, true), "Explore · Waiting for approval · 1m 15s");
  assert.equal(agent_meta(t, agent_entry(2, "completed", { role: "skeptic" }), now, false), "skeptic · 10s");
  assert.equal(agent_meta(t, agent_entry(2, "cached", { role: "inline" }), now, false), "Own role · Cached");
  assert.equal(agent_meta(t, agent_entry(2, "failed"), now, true), "Worker · Failed · 10s");
  assert.equal(agent_meta(t, agent_entry(2, "starting", { started_at: null }), now, false), "Worker · Starting");
  assert.equal(agent_meta(t, agent_entry(2, "stopped"), now, false), "Worker · Stopped · 10s");
  assert.equal(agent_meta(de, agent_entry(2, "skipped"), now, false), "Worker · Übersprungen · 10s");
  assert.equal(role_label(de, "explore"), "Explore");
  assert.equal(agent_time(agent_entry(0, "running", { started_at: at(75) }), now), "");
  assert.equal(agent_ms(agent_entry(0, "interrupted", { ended_at: null }), now), null);
  assert.equal(agent_ms(agent_entry(0, "running", { started_at: "not a date" }), now), null);
});

test("only live agents can be skipped and only started agents open a transcript", () => {
  assert.deepEqual(
    (["starting", "running", "completed", "failed", "skipped", "stopped", "interrupted", "cached"] as const).map((status) => can_skip(agent_entry(0, status))),
    [true, true, false, false, false, false, false, false],
  );
  assert.deepEqual(agent_transcript(agent_entry(4, "running")), { agent_id: "agent_4", run_id: "run_4" });
  assert.equal(agent_transcript(agent_entry(4, "cached")), null);
  assert.equal(agent_transcript(agent_entry(4, "starting", { agent_run_id: null })), null);
});

test("agent hints and errors carry model, effort, worktree and the reason it ended", () => {
  const isolated = agent_entry(1, "failed", { worktree: { path: "C:/wt/a", branch: "vx/fix-a", kept: true }, error: "provider error 500" });
  assert.equal(agent_hint(t, isolated, "Model A"), "agent 1\nModel A · high\nWorktree vx/fix-a, kept\nprovider error 500");
  assert.equal(agent_hint(t, agent_entry(1, "running", { worktree: { path: "C:/wt/b", branch: "vx/b", kept: false }, effort: "" }), "Model A"), "agent 1\nModel A\nWorktree vx/b");
  assert.equal(shown_error(isolated), "provider error 500");
  assert.equal(shown_error(agent_entry(1, "completed", { error: "stale" })), "");
  assert.equal(shown_error(agent_entry(1, "skipped", { error: "Skipped by the user." })), "Skipped by the user.");
});

test("the approval text splits into the script and its args", () => {
  const script = "export const meta = { name: 'a', description: 'b' }\nconst x = 'args: no'\n\nargs: inside a string\nreturn x";
  assert.deepEqual(split_workflow_approval(`${script}\n\nargs: {\n  "files": [\n    "a.ts"\n  ]\n}`), { script, args: '{\n  "files": [\n    "a.ts"\n  ]\n}' });
  assert.deepEqual(split_workflow_approval(`${script}\n\nargs: (no args)`), { script, args: null });
  assert.deepEqual(split_workflow_approval("return 1"), { script: "return 1", args: null });
});

const notice = (name: string, status: "completed" | "stopped" | "failed", value = '{"ok":true}') =>
  workflow_notice_text({
    summary: summary_of(status, [agent_entry(0, "completed")], { name, run_id: `wf_${name}-0000`, error: status === "failed" ? "boom" : "" }),
    value_json: value,
    result_path: "C:/r.json",
    stopped_by: "the user",
  });

test("batched workflow notices split into one parsed notice each and ignore other text", () => {
  const text = `${notice("first", "completed")}\n\n${notice("second", "stopped")}`;
  const parts = split_workflow_notices(text);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map(parse_workflow_notice), [
    { name: "first", run_id: "wf_first-0000", status: "completed" },
    { name: "second", run_id: "wf_second-0000", status: "stopped" },
  ]);
  assert.deepEqual(split_workflow_notices("plain text"), []);
  assert.deepEqual(split_workflow_notices("[WORKFLOW RESULT EVENT]\nno head line"), []);
  const tricky = notice("third", "completed", '{"text":"[WORKFLOW RESULT EVENT] inside the value"}');
  assert.deepEqual(split_workflow_notices(tricky).map(parse_workflow_notice), [{ name: "third", run_id: "wf_third-0000", status: "completed" }]);
});

const assistant = (id: string, steps: AssistantMessage["steps"], status: AssistantMessage["status"] = "done"): AssistantMessage => ({
  id,
  role: "assistant",
  model: "m",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-30T09:00:00.000Z",
  ended_at: "2026-10-30T09:05:00.000Z",
  status,
  steps,
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

const origin_message = (id: string, text: string): UserMessage => ({ id, role: "user", text, attachments: [], origin: "workflow", created_at: "2026-10-30T09:06:00.000Z" });

test("a workflow result turn joins the tool flow of its turn as one notice per workflow", () => {
  const messages: Message[] = [
    assistant("a-1", [tool_step("run_workflow", workflow_tool_view(), "done", {}, "t1")]),
    origin_message("u-1", `${notice("first", "completed")}\n\n${notice("second", "failed")}`),
    assistant("a-2", [tool_step("read_file", null, "done", { path: "r.json" }, "t2")]),
  ];
  const layout = turn_layout(messages);
  assert.deepEqual([...layout.absorbed], ["u-1"]);
  const lead = layout.lead.get("a-2") ?? [];
  assert.deepEqual(lead.map((step) => [step.id, step.notice, parse_workflow_notice(step.text)?.name]), [
    ["origin:u-1:0", "workflow_result", "first"],
    ["origin:u-1:1", "workflow_result", "second"],
  ]);
  const blocks = build_blocks([...lead, ...(messages[2] as AssistantMessage).steps]);
  assert.deepEqual(blocks.map((block) => block.kind), ["work"]);
  assert.deepEqual(blocks[0]?.kind === "work" ? blocks[0].steps.map((step) => step.id) : [], ["origin:u-1:0", "origin:u-1:1", "t2"]);
  const unparsed = turn_layout([assistant("a-1", []), origin_message("u-2", "no notice here"), assistant("a-3", [])]);
  assert.deepEqual([...unparsed.absorbed], []);
});

test("an in-turn workflow result notice is shown in the tool flow, not hidden", () => {
  const step: NoticeStep = { id: "n1", round: 2, kind: "notice", notice: "workflow_result", text: notice("first", "completed") };
  const blocks = build_blocks([tool_step("read_file", null, "done", { path: "a" }, "t1"), step]);
  assert.deepEqual(blocks[0]?.kind === "work" ? blocks[0].steps.map((entry) => entry.id) : [], ["t1", "n1"]);
  assert.deepEqual(build_blocks([step]).map((block) => block.kind), ["notice"]);
});

test("a turn lists the workflows its members started so the fold can wait for them", () => {
  const first = assistant("a-1", [tool_step("run_workflow", workflow_tool_view(), "done", {}, "t1"), tool_step("stop_workflow", workflow_tool_view("stopped"), "done", { run_id }, "t2")]);
  const second = assistant("a-2", [tool_step("run_workflow", { ...workflow_tool_view(), run_id: "wf_second" }, "done", {}, "t3")]);
  const shape = turn_shape([member_facts(first, build_blocks(first.steps)), member_facts(second, build_blocks(second.steps))]);
  assert.deepEqual(shape.workflows, [run_id, "wf_second"]);
  const quiet = assistant("a-3", [tool_step("read_file", null, "done", { path: "a" }, "t4")]);
  assert.deepEqual(turn_shape([member_facts(quiet, build_blocks(quiet.steps))]).workflows, []);
});
