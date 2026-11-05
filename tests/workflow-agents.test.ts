import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { inline_result_chars, parse_workflow_notice, workflow_notice_text } from "../shared/workflow-notes.ts";
import type { WorkflowSummary } from "../shared/workflow.ts";
import { events } from "./agents-runner-harness.ts";
import { live_runs, waiting_approvals } from "../electron/agents/live.ts";
import { parse_index, public_summary } from "../electron/agents/records.ts";
import { deploy_agent, max_running_agents } from "../electron/agents/runner.ts";
import { agent_approval_key } from "../electron/agents/session.ts";
import { get_agent } from "../electron/agents/store.ts";
import { resolve_decision } from "../electron/permissions/approvals.ts";
import { mark_interrupted, parse_state } from "../electron/workflows/records.ts";
import { stop_chat_workflows } from "../electron/workflows/runtime.ts";
import { block_until_abort, completed, offered, request, scripts, stop_runner, tools } from "./agents-runner-harness.ts";
import { contents, ended, launch, start_workflows, summary, wait_until } from "./workflow-run-kit.ts";

before(async () => {
  await start_workflows();
  tools.push(
    { spec: { name: "message_main_agent", description: "", parameters: { type: "object", properties: {} } }, profiles: ["explore", "worker"], available: () => true, execute: async () => ({ status: "done", text: "", view: null }) },
    { spec: { name: "message_peer", description: "", parameters: { type: "object", properties: {} } }, profiles: ["explore", "worker"], available: () => true, execute: async () => ({ status: "done", text: "", view: null }) },
    { spec: { name: "read_file", description: "", parameters: { type: "object", properties: {} } }, profiles: ["explore", "worker"], available: () => true, execute: async () => ({ status: "done", text: "file", view: null }) },
  );
});

after(stop_runner);

test("workflow agents lose the main-agent and peer tools, get no roster and their text is the return value", async () => {
  let seen: string[] = [];
  scripts.set("wf tools check", async (messages) => {
    seen = contents(messages);
    return completed({ content: "checked" });
  });
  scripts.set("plain agent check", async () => completed({ content: "plain" }));
  const done = await ended((await launch("chat-wf-tools", "return await agent('wf tools check')")).summary.run_id);
  assert.equal(done.result_preview, '"checked"');
  assert.deepEqual(offered.get("wf tools check"), [1]);
  assert.ok(!seen.some((text) => text.includes("Agents in this chat at")), "no roster note");
  assert.match(seen[0] ?? "", /Your final message is the return value of agent\(\) in the script, not a message to a person/);
  deploy_agent(request("plain agent check", { chat_id: "chat-wf-tools" }));
  await wait_until(() => (offered.get("plain agent check") ?? []).length > 0, "the plain agent to run");
  assert.deepEqual(offered.get("plain agent check"), [3]);
});

test("a workflow agent's tool call waits for the normal approval keyed by its run", async () => {
  tools.push({
    spec: { name: "needs_ok", description: "", parameters: { type: "object", properties: {} } },
    profiles: ["worker"],
    available: () => true,
    execute: async (ctx) => {
      const decision = await ctx.approve({ kind: "memory", action: "remember", text: "x" });
      return { status: decision.approved ? "done" : "denied", text: decision.approved ? "ok" : "no", view: null };
    },
  });
  let round = 0;
  scripts.set("wf ask first", async () => {
    round += 1;
    return round === 1 ? completed({ tool_calls: [{ index: 0, id: "ok0", name: "needs_ok", arguments: "{}" }], finish_reason: "tool_calls" }) : completed({ content: "approved" });
  });
  const run_id = (await launch("chat-wf-approve", "return await agent('wf ask first')")).summary.run_id;
  await wait_until(() => waiting_approvals("chat-wf-approve").length === 1, "the approval");
  const [waiting] = waiting_approvals("chat-wf-approve");
  assert.equal(waiting?.agent_id, summary(run_id).agents[0]?.agent_id);
  assert.equal(resolve_decision(agent_approval_key(waiting?.run_id ?? ""), waiting?.call_id ?? "", { approved: true, grant: "once", feedback: "" }), true);
  const done = await ended(run_id);
  assert.equal(done.result_preview, '"approved"');
  tools.pop();
});

test("a workflow runs more agents at once than deploy_agent allows and does not use up that limit", async () => {
  const count = max_running_agents + 5;
  for (let index = 0; index < count; index += 1) {
    scripts.set(`wf wide ${index}`, block_until_abort);
  }
  scripts.set("plain beside wide", async () => completed({ content: "fine" }));
  const run_id = (await launch("chat-wide", `return await parallel(Array.from({ length: ${count} }, (_, i) => () => agent('wf wide ' + i)))`)).summary.run_id;
  await wait_until(() => summary(run_id).agents.filter((agent) => agent.status === "running").length === count, "every agent to run");
  assert.equal(live_runs().filter((live) => live.chat_id === "chat-wide").length, count);
  const plain = deploy_agent(request("plain beside wide", { chat_id: "chat-wide" }));
  assert.equal(plain.run.status, "running");
  assert.equal(stop_chat_workflows("chat-wide", "user"), 1);
  assert.equal(summary(run_id).status, "stopped");
  await wait_until(() => live_runs().filter((live) => live.chat_id === "chat-wide").length === 0, "every run to end");
  assert.ok(events.filter((event) => event.type === "end").length >= count);
});

test("the workflow link of an agent record survives the agent index", () => {
  const now = new Date().toISOString();
  const stored = { agents: [{ agent_id: "agent_1", chat_id: "c", runs: [], workflow: { run_id: "wf_00000000-1", index: 3 } }, { agent_id: "agent_2", chat_id: "c", runs: [], workflow: { run_id: 5 } }] };
  const { records } = parse_index(stored, now);
  const by_id = new Map(records.map((record) => [record.agent_id, record]));
  assert.deepEqual(by_id.get("agent_1")?.workflow, { run_id: "wf_00000000-1", index: 3 });
  assert.equal(by_id.get("agent_2")?.workflow, undefined);
  const record = by_id.get("agent_1");
  assert.ok(record);
  assert.deepEqual(public_summary(record).workflow, { run_id: "wf_00000000-1", index: 3 });
  assert.equal("workflow" in public_summary(by_id.get("agent_2") ?? record), false);
  assert.equal(get_agent("agent_1"), null);
});

const sample = (over: Partial<WorkflowSummary> = {}): WorkflowSummary => ({
  run_id: "wf_00000000-0001",
  chat_id: "c",
  name: "sample",
  description: "d",
  when_to_use: "",
  status: "completed",
  started_at: "2026-01-01T00:00:00.000Z",
  ended_at: "2026-01-01T00:01:05.000Z",
  phases: [],
  agents: [
    { index: 0, label: "a", phase: null, role: "worker", model: "m", effort: "", status: "completed", agent_id: null, agent_run_id: null, started_at: null, ended_at: null, worktree: null, structured: false, preview: "", error: "" },
    { index: 1, label: "b", phase: null, role: "worker", model: "m", effort: "", status: "cached", agent_id: null, agent_run_id: null, started_at: null, ended_at: null, worktree: null, structured: false, preview: "", error: "" },
    { index: 2, label: "c", phase: null, role: "worker", model: "m", effort: "", status: "skipped", agent_id: null, agent_run_id: null, started_at: null, ended_at: null, worktree: null, structured: false, preview: "", error: "" },
  ],
  logs: [],
  script_path: "C:/runs/s.js",
  resumed_from: null,
  result_preview: "",
  error: "",
  parent_message_id: "m",
  parent_call_id: "c",
  counts: { completed: 1, failed: 0, skipped: 1, stopped: 0, cached: 1, running: 0 },
  ...over,
});

test("the notice text carries the outcome and cuts a long return value with the path", () => {
  const short = workflow_notice_text({ summary: sample(), value_json: '{"ok":true}', result_path: "C:/runs/result.json", stopped_by: "the user" });
  assert.equal(
    short,
    "[WORKFLOW RESULT EVENT]\nWorkflow sample (run wf_00000000-0001) ended with status completed after 65s.\nAgents: 3 (1 completed, 1 cached, 1 skipped).\nScript: C:/runs/s.js\nReturn value (JSON, also saved in C:/runs/result.json):\n{\"ok\":true}",
  );
  assert.deepEqual(parse_workflow_notice(short), { name: "sample", run_id: "wf_00000000-0001", status: "completed" });
  const long = workflow_notice_text({ summary: sample(), value_json: `"${"x".repeat(inline_result_chars + 10)}"`, result_path: "C:/runs/result.json", stopped_by: "the user" });
  assert.match(long, /Return value \(JSON, 40012 characters; the first 40000 follow, read the complete value from C:\/runs\/result\.json before relying on the rest\):/);
  assert.ok(long.length < inline_result_chars + 600);
  const failed = workflow_notice_text({ summary: sample({ status: "failed", error: "TypeError: x" }), value_json: null, result_path: null, stopped_by: "the user" });
  assert.match(failed, /\nError: TypeError: x\nResume it with run_workflow and resume_from wf_00000000-0001/);
  assert.equal(parse_workflow_notice("plain text"), null);
});

test("stored run states are validated and a running state comes back interrupted", () => {
  const now = "2026-02-02T00:00:00.000Z";
  assert.equal(parse_state({ summary: { run_id: "../escape", chat_id: "c" } }, now), null);
  assert.equal(parse_state({ summary: { run_id: "wf_00000000-0001" } }, now), null);
  const parsed = parse_state({ summary: { ...sample({ status: "running", ended_at: null }), agents: [{ index: 0, status: "running" }, { index: -1 }, { index: 1, status: "bogus" }] }, args_text: "[1]" }, now);
  assert.ok(parsed);
  assert.equal(parsed.notice_due, true);
  assert.equal(parsed.args_text, "[1]");
  assert.equal(parsed.summary.status, "interrupted");
  assert.deepEqual(parsed.summary.agents.map((agent) => [agent.index, agent.status]), [
    [0, "interrupted"],
    [1, "interrupted"],
  ]);
  assert.equal(mark_interrupted(sample(), now, "why").agents[0]?.status, "completed");
  assert.equal(parse_state({ summary: sample({ status: "interrupted" }), notice_due: true }, now)?.notice_due, true);
  assert.equal(parse_state({ summary: sample({ status: "interrupted" }) }, now)?.notice_due, false);
  assert.equal(parse_state({ summary: sample({ status: "completed" }), notice_due: "yes" }, now)?.notice_due, false);
});

test("the workflow channels are declared and reachable from the phone and tablet interface", async () => {
  const { channel_kind } = await import("../shared/ipc/index.ts");
  const { remote_hidden_events, remote_refused } = await import("../shared/remote-policy.ts");
  for (const name of ["workflows:list", "workflows:get", "workflows:stop", "workflows:skip_agent"] as const) {
    assert.equal(channel_kind(name), "invoke", name);
    assert.equal(remote_refused.has(name), false, name);
  }
  assert.equal(channel_kind("workflows:changed"), "event");
  assert.equal(remote_hidden_events.has("workflows:changed"), false);
});
