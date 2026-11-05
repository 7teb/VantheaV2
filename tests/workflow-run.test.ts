import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { after, before, test } from "node:test";
import { live_runs } from "../electron/agents/live.ts";
import { has_agent_notes, take_agent_notes } from "../electron/agents/reports.ts";
import { get_agent } from "../electron/agents/store.ts";
import { skip_workflow_agent, stop_workflow_run } from "../electron/workflows/runtime.ts";
import { result_file } from "../electron/workflows/store.ts";
import { block_until_abort, completed, reports, scripts, stop_runner, workflow_notices } from "./agents-runner-harness.ts";
import { contents, ended, launch, launch_source, result_call, start_workflows, summary, wait_until } from "./workflow-run-kit.ts";

before(start_workflows);

after(stop_runner);

test("agents run as real sub-agents and the return value reaches the main agent once", async () => {
  scripts.set("wf say a", async () => completed({ content: "A done" }));
  scripts.set("wf say b", async (messages) => completed({ content: contents(messages)[0]?.includes("Your profile is explore") ? "B explored" : "B wrong profile" }));
  const started = await launch("chat-text", "phase('Scan')\nconst out = await parallel([() => agent('wf say a'), () => agent('wf say b', { label: 'B', role: 'explore' })])\nlog('both back')\nreturn { out }");
  assert.equal(started.start_error, null);
  const done = await ended(started.summary.run_id);
  assert.equal(done.status, "completed");
  assert.deepEqual(JSON.parse(await fs.readFile(result_file(done.run_id), "utf8")), { out: ["A done", "B explored"] });
  assert.deepEqual(done.agents.map((agent) => [agent.index, agent.label, agent.phase, agent.role, agent.status, agent.preview]), [
    [0, "wf-test #1", "Scan", "worker", "completed", "A done"],
    [1, "B", "Scan", "explore", "completed", "B explored"],
  ]);
  assert.deepEqual(done.phases.map((phase) => [phase.title, phase.detail]), [["Scan", "scan things"]]);
  assert.deepEqual(done.logs.map((entry) => [entry.kind, entry.text]), [["log", "both back"]]);
  assert.deepEqual(done.counts, { completed: 2, failed: 0, skipped: 0, stopped: 0, cached: 0, running: 0 });
  const record = get_agent(done.agents[1]?.agent_id ?? "");
  assert.deepEqual(record?.workflow, { run_id: done.run_id, index: 1 });
  assert.equal(record?.profile, "explore");
  assert.equal(reports.filter((report) => report.chat_id === "chat-text").length, 0);
  await wait_until(() => workflow_notices.some((notice) => notice.run_id === done.run_id), "the result notice");
  const notices = workflow_notices.filter((notice) => notice.run_id === done.run_id);
  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.held, false);
  assert.match(notices[0]?.text ?? "", /^\[WORKFLOW RESULT EVENT\]\nWorkflow wf-test \(run wf_[^)]+\) ended with status completed after \d+s\.\nAgents: 2 \(2 completed\)\.\nScript: .*script\.js\nReturn value \(JSON, also saved in .*result\.json\):\n\{"out":\["A done","B explored"\]\}$/);
});

test("a schema forces a validated result, retries a mismatch and reminds an agent that ends without one", async () => {
  const seen: string[][] = [];
  let round = 0;
  scripts.set("wf count", async (messages) => {
    seen.push(contents(messages));
    round += 1;
    if (round === 1) return completed({ content: "I think it is three." });
    if (round === 2) return result_call({ n: "three" });
    if (round === 3) return result_call({ n: 3 });
    return completed({ content: "Recorded." });
  });
  const started = await launch("chat-schema", "const r = await agent('wf count', { schema: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] } })\nreturn r");
  const done = await ended(started.summary.run_id);
  assert.equal(done.status, "completed");
  assert.equal(done.result_preview, '{"n":3}');
  assert.equal(done.agents[0]?.structured, true);
  const second = seen[1] ?? [];
  assert.ok(second.some((text) => text.includes("no valid result has been recorded yet. Call structured_result now")), "the reminder reached the agent");
  const fourth = seen[3] ?? [];
  assert.ok(fourth.some((text) => text.includes("/n must be integer, got string")), "the mismatch was reported");
  assert.ok(fourth.some((text) => text.includes("Result recorded as the return value")));
  assert.match(seen[0]?.[0] ?? "", /<workflow_agent_role>[\s\S]*Return your result by calling structured_result/);
  assert.doesNotMatch(seen[0]?.[0] ?? "", /<sub_agent_role>/);
});

test("a provider refusal ends a schema agent at once instead of reminding it, and agent() resolves to null with the refusal as reason", async () => {
  let rounds = 0;
  scripts.set("wf refused", async () => {
    rounds += 1;
    return completed({ content: "This request triggered restrictions on violative cyber content and was blocked.", finish_reason: "content_filter" });
  });
  const started = await launch("chat-refusal", "const r = await agent('wf refused', { schema: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] } })\nreturn { r }");
  const done = await ended(started.summary.run_id);
  assert.equal(rounds, 1);
  assert.equal(done.status, "completed");
  assert.equal(done.result_preview, '{"r":null}');
  assert.equal(done.agents[0]?.status, "failed");
  assert.match(done.agents[0]?.error ?? "", /without a valid structured result, its last message: This request triggered restrictions/);
});

test("a script-defined role reaches the agent's system prompt, unknown roles, models and schemas reject agent()", async () => {
  let system = "";
  scripts.set("wf strict judge", async (messages) => {
    system = contents(messages)[0] ?? "";
    return completed({ content: "8" });
  });
  const started = await launch_source(
    "chat-roles",
    [
      "export const meta = { name: 'roles', description: 'role test', roles: { judge: { profile: 'explore', instructions: 'Score strictly from 1 to 10.', effort: 'high' } } }",
      "const judged = await agent('wf strict judge', { role: 'judge' })",
      "const errors = []",
      "try { await agent('wf never', { role: 'nobody' }) } catch (error) { errors.push(error.message) }",
      "try { await agent('wf never', { model: 'no/such-model' }) } catch (error) { errors.push(error.message) }",
      "try { await agent('wf never', { schema: { type: 'object', properties: { a: { $ref: '#' } } } }) } catch (error) { errors.push(error.message) }",
      "return { judged, errors }",
    ].join("\n"),
  );
  const done = await ended(started.summary.run_id);
  const value = JSON.parse(await fs.readFile(result_file(done.run_id), "utf8")) as { judged: string; errors: string[] };
  assert.equal(value.judged, "8");
  assert.match(system, /Your role is judge\. Its instructions:\nScore strictly from 1 to 10\./);
  assert.match(system, /Your profile is explore/);
  assert.match(value.errors[0] ?? "", /^Unknown role nobody\. Known roles: judge, explore, worker\./);
  assert.match(value.errors[1] ?? "", /^Unknown model no\/such-model/);
  assert.match(value.errors[2] ?? "", /uses \$ref/);
  assert.deepEqual(done.agents.map((agent) => [agent.role, agent.status]), [
    ["judge", "completed"],
    ["nobody", "failed"],
    ["worker", "failed"],
    ["worker", "failed"],
  ]);
  assert.equal(done.agents[0]?.effort, "");
});

test("a failing agent resolves to null and a skipped agent resolves to null", async () => {
  scripts.set("wf will fail", async () => {
    throw new Error("provider exploded");
  });
  scripts.set("wf will be skipped", block_until_abort);
  const started = await launch("chat-null", "const [failed, skipped] = await parallel([() => agent('wf will fail'), () => agent('wf will be skipped')])\nreturn { failed, skipped }");
  const run_id = started.summary.run_id;
  await wait_until(() => summary(run_id).agents[1]?.status === "running", "the blocking agent to run");
  assert.equal(skip_workflow_agent(run_id, 1), true);
  const done = await ended(run_id);
  assert.equal(done.status, "completed");
  assert.equal(done.result_preview, '{"failed":null,"skipped":null}');
  assert.deepEqual(done.agents.map((agent) => agent.status), ["failed", "skipped"]);
  assert.match(done.agents[0]?.error ?? "", /provider exploded/);
  assert.equal(skip_workflow_agent(run_id, 1), false);
});

test("stop ends the run once, stops every agent and holds the notice for the next turn", async () => {
  scripts.set("wf hold 1", block_until_abort);
  scripts.set("wf hold 2", block_until_abort);
  const started = await launch("chat-stop", "await parallel([() => agent('wf hold 1'), () => agent('wf hold 2')])\nreturn 'never'");
  const run_id = started.summary.run_id;
  await wait_until(() => summary(run_id).agents.filter((agent) => agent.status === "running").length === 2, "both agents to run");
  assert.equal(stop_workflow_run(run_id, "user"), true);
  assert.equal(stop_workflow_run(run_id, "user"), false);
  const done = summary(run_id);
  assert.equal(done.status, "stopped");
  assert.equal(done.error, "The user stopped the workflow.");
  assert.deepEqual(done.agents.map((agent) => agent.status), ["stopped", "stopped"]);
  await wait_until(() => live_runs().every((live) => live.chat_id !== "chat-stop"), "the agent runs to end");
  await wait_until(() => has_agent_notes("chat-stop"), "the held notice");
  assert.equal(workflow_notices.some((notice) => notice.run_id === run_id), false);
  const notes = take_agent_notes("chat-stop");
  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.kind === "notice" ? notes[0].notice : "", "workflow_result");
  assert.match(notes[0]?.text ?? "", /ended with status stopped[\s\S]*It was stopped by the user\. The user stopped the workflow\.[\s\S]*resume_from wf_/);
  assert.deepEqual(summary(run_id).agents.map((agent) => agent.status), ["stopped", "stopped"]);
});

test("a script error fails the run and the main agent gets the error", async () => {
  scripts.set("wf before error", async () => completed({ content: "fine" }));
  const started = await launch("chat-error", "await agent('wf before error')\nthrow new Error('the script broke')");
  const done = await ended(started.summary.run_id);
  assert.equal(done.status, "failed");
  assert.match(done.error, /^Error: the script broke\n.*wf-test\.js:3/);
  await wait_until(() => workflow_notices.some((notice) => notice.run_id === done.run_id), "the failure notice");
  assert.match(workflow_notices.find((notice) => notice.run_id === done.run_id)?.text ?? "", /status failed[\s\S]*Error: Error: the script broke/);
});

test("agents still running when the script returns are stopped and logged", async () => {
  scripts.set("wf orphan", block_until_abort);
  const started = await launch("chat-orphan", "agent('wf orphan')\nreturn 'early'");
  const done = await ended(started.summary.run_id);
  assert.equal(done.status, "completed");
  assert.equal(done.result_preview, '"early"');
  await wait_until(() => summary(done.run_id).agents[0]?.status === "stopped", "the orphan to stop");
  assert.match(summary(done.run_id).logs.at(-1)?.text ?? "", /^1 agent was still running when the script returned and was stopped/);
  await wait_until(() => live_runs().every((live) => live.chat_id !== "chat-orphan"), "the orphan run to end");
});

test("a syntax error fails at compile time without a notice", async () => {
  const started = await launch("chat-compile", "const x: number = 1");
  assert.match(started.start_error ?? "", /^SyntaxError/);
  assert.equal(started.summary.status, "failed");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(workflow_notices.some((notice) => notice.run_id === started.summary.run_id), false);
  assert.equal(has_agent_notes("chat-compile"), false);
});
