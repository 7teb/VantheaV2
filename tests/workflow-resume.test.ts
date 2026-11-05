import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { live_runs } from "../electron/agents/live.ts";
import { has_agent_notes, take_agent_notes } from "../electron/agents/reports.ts";
import { cancel_agent } from "../electron/agents/runner.ts";
import { get_agent } from "../electron/agents/store.ts";
import { writes_settled } from "../electron/storage/json-file.ts";
import { live_workflows } from "../electron/workflows/live.ts";
import { app_closed_text } from "../electron/workflows/records.ts";
import { clear_chat_workflows, init_workflows, shutdown_workflows_sync, skip_workflow_agent } from "../electron/workflows/runtime.ts";
import { get_run, read_calls, run_dir } from "../electron/workflows/store.ts";
import { block_until_abort, completed, scripts, stop_runner, workflow_notices } from "./agents-runner-harness.ts";
import { ended, launch, sleep, start_workflows, summary, wait_until, workflows_dir } from "./workflow-run-kit.ts";

before(start_workflows);

after(stop_runner);

const calls = new Map<string, number>();

const counted = (prompt: string, content: string, delay = 0) =>
  scripts.set(prompt, async () => {
    calls.set(prompt, (calls.get(prompt) ?? 0) + 1);
    if (delay) {
      await sleep(delay);
    }
    return completed({ content });
  });

const pipeline_script = (variant = "") =>
  `return await pipeline(args.items, (item) => agent('wf r1 ' + item), (prev, item) => agent('wf r2 ' + item + (item === 'A' ? '${variant}' : '') + ' got ' + prev))`;

test("resume replays journaled results in their old order, so out-of-order agents hit the cache", async () => {
  counted("wf r1 A", "a1", 80);
  counted("wf r1 B", "b1");
  counted("wf r2 B got b1", "b2");
  counted("wf r2 A got a1", "a2");
  counted("wf r2 A v2 got a1", "a2 v2");
  const first = await ended((await launch("chat-resume", pipeline_script(), { items: ["A", "B"] })).summary.run_id);
  assert.equal(first.status, "completed");
  assert.equal(first.result_preview, '["a2","b2"]');
  assert.deepEqual(first.agents.map((agent) => agent.preview), ["a1", "b1", "b2", "a2"]);

  const second_start = await launch("chat-resume", pipeline_script(), { items: ["A", "B"] }, { run_id: first.run_id, journal: await read_calls(first.run_id) });
  const second = await ended(second_start.summary.run_id);
  assert.equal(second.status, "completed");
  assert.equal(second.resumed_from, first.run_id);
  assert.equal(second.result_preview, '["a2","b2"]');
  assert.deepEqual(second.agents.map((agent) => [agent.index, agent.status, agent.agent_id]), [
    [0, "cached", null],
    [1, "cached", null],
    [2, "cached", null],
    [3, "cached", null],
  ]);
  assert.deepEqual(Object.fromEntries(calls), { "wf r1 A": 1, "wf r1 B": 1, "wf r2 B got b1": 1, "wf r2 A got a1": 1 });

  const third_start = await launch("chat-resume", pipeline_script(" v2"), { items: ["A", "B"] }, { run_id: second.run_id, journal: await read_calls(second.run_id) });
  const third = await ended(third_start.summary.run_id);
  assert.equal(third.result_preview, '["a2 v2","b2"]');
  assert.deepEqual(third.agents.map((agent) => agent.status), ["cached", "cached", "cached", "completed"]);
  assert.equal(calls.get("wf r2 A v2 got a1"), 1);
  assert.equal(calls.get("wf r2 A got a1"), 1);
});

test("the first changed call and everything after it run live", async () => {
  counted("wf seq 1", "one");
  counted("wf seq 2", "two");
  counted("wf seq 2 changed", "two changed");
  counted("wf seq 3", "three");
  const script = (second: string) => `const a = await agent('wf seq 1')\nconst b = await agent('${second}')\nconst c = await agent('wf seq 3')\nreturn [a, b, c]`;
  const first = await ended((await launch("chat-prefix", script("wf seq 2"))).summary.run_id);
  const second = await ended((await launch("chat-prefix", script("wf seq 2 changed"), undefined, { run_id: first.run_id, journal: await read_calls(first.run_id) })).summary.run_id);
  assert.deepEqual(second.agents.map((agent) => agent.status), ["cached", "completed", "completed"]);
  assert.equal(calls.get("wf seq 1"), 1);
  assert.equal(calls.get("wf seq 3"), 2);
  assert.equal(second.result_preview, '["one","two changed","three"]');
});

test("failed agents run again on resume while skipped ones stay null", async () => {
  let healthy = false;
  scripts.set("wf flaky", async () => {
    if (!healthy) {
      throw new Error("provider down");
    }
    return completed({ content: "now fine" });
  });
  counted("wf steady", "steady");
  const script = "const [a, b] = await parallel([() => agent('wf steady'), () => agent('wf flaky')])\nreturn { a, b }";
  const first = await ended((await launch("chat-rerun", script)).summary.run_id);
  assert.equal(first.result_preview, '{"a":"steady","b":null}');
  healthy = true;
  const second = await ended((await launch("chat-rerun", script, undefined, { run_id: first.run_id, journal: await read_calls(first.run_id) })).summary.run_id);
  assert.equal(second.result_preview, '{"a":"steady","b":"now fine"}');
  assert.deepEqual(second.agents.map((agent) => agent.status), ["cached", "completed"]);
  assert.equal(calls.get("wf steady"), 1);
});

test("skipping a journaled call while it waits in the replay queue makes agent() resolve to null", async () => {
  counted("wf held a", "A");
  counted("wf held b", "B");
  const script = "const first = agent('wf held a')\nconst second = agent('wf held b')\nreturn [await first, await second]";
  const first = await ended((await launch("chat-held", script)).summary.run_id);
  assert.equal(first.result_preview, '["A","B"]');
  const starting = launch("chat-held", script, undefined, { run_id: first.run_id, journal: await read_calls(first.run_id) });
  const run = live_workflows().find((entry) => entry.context.chat_id === "chat-held");
  assert.ok(run, "start_workflow tracks the run before its first await");
  const acked = run.replay.acked;
  const skips: { index: number; skipped: boolean }[] = [];
  run.replay.acked = (seq) => {
    const held = summary(run.run_id).agents.filter((agent) => agent.status === "starting");
    if (seq > 0 && !skips.length && held.length === 1 && held[0]) {
      skips.push({ index: held[0].index, skipped: skip_workflow_agent(run.run_id, held[0].index) });
    }
    acked(seq);
  };
  const done = await ended((await starting).summary.run_id);
  const [skip] = skips;
  assert.ok(skip, "the second hit waited in the replay queue while the script took the first one");
  assert.equal(skip.skipped, true);
  const values = ["A", "B"].map((value, index) => (index === skip.index ? null : value));
  assert.equal(done.result_preview, JSON.stringify(values));
  assert.deepEqual(done.agents.map((agent) => agent.status), values.map((value) => (value === null ? "skipped" : "cached")));
  const ends = await read_calls(done.run_id);
  assert.deepEqual([ends.get(skip.index)?.end?.status, ends.get(skip.index)?.end?.result], ["skipped", null]);
  assert.deepEqual([calls.get("wf held a"), calls.get("wf held b")], [1, 1]);
});

test("quitting the app marks a running workflow interrupted on disk", async () => {
  scripts.set("wf until quit", block_until_abort);
  const started = await launch("chat-quit", "return await agent('wf until quit')");
  const run_id = started.summary.run_id;
  await wait_until(() => summary(run_id).agents[0]?.status === "running", "the agent to run");
  const agent_id = summary(run_id).agents[0]?.agent_id ?? "";
  shutdown_workflows_sync();
  const state = JSON.parse(await fs.readFile(path.join(run_dir(run_id), "state.json"), "utf8")) as { summary: { status: string; error: string; agents: { status: string }[] } };
  assert.equal(state.summary.status, "interrupted");
  assert.equal(state.summary.error, app_closed_text);
  assert.equal(state.summary.agents[0]?.status, "interrupted");
  assert.equal(workflow_notices.some((notice) => notice.run_id === run_id), false);
  const agent = get_agent(agent_id);
  assert.ok(agent);
  cancel_agent(agent);
  await wait_until(() => live_runs().every((live) => live.chat_id !== "chat-quit"), "the agent run to end");
  take_agent_notes("chat-quit");
  await init_workflows(workflows_dir());
  assert.equal(get_run(run_id)?.summary.status, "interrupted");
  const notes = take_agent_notes("chat-quit").filter((note) => note.text.includes(run_id));
  assert.equal(notes.length, 1, "the next start holds one notice for the interrupted run");
  assert.match(notes[0]?.text ?? "", /ended with status interrupted/);
  await writes_settled(path.join(run_dir(run_id), "state.json"));
  await init_workflows(workflows_dir());
  assert.equal(has_agent_notes("chat-quit"), false, "a second start does not repeat the notice");
  scripts.set("wf until quit", async () => completed({ content: "after restart" }));
  const resumed = await ended((await launch("chat-quit", "return await agent('wf until quit')", undefined, { run_id, journal: await read_calls(run_id) })).summary.run_id);
  assert.equal(resumed.result_preview, '"after restart"');
  assert.deepEqual(resumed.agents.map((entry) => entry.status), ["completed"]);
});

test("a run left running by a crash is interrupted at the next start and the chat learns about it", async () => {
  const run_id = "wf_00000000-crash-0001";
  const now = new Date().toISOString();
  const agent = { index: 0, label: "x", phase: null, role: "worker", model: "test/model", effort: "", status: "running", agent_id: null, agent_run_id: null, started_at: now, ended_at: null, worktree: null, structured: false, preview: "", error: "" };
  const state = {
    version: 1,
    args_text: "",
    summary: { run_id, chat_id: "chat-crash", name: "crashed", description: "d", when_to_use: "", status: "running", started_at: now, ended_at: null, phases: [], agents: [agent], logs: [], script_path: "s.js", resumed_from: null, result_preview: "", error: "", parent_message_id: "m", parent_call_id: "c" },
  };
  await fs.mkdir(run_dir(run_id), { recursive: true });
  await fs.writeFile(path.join(run_dir(run_id), "state.json"), JSON.stringify(state));
  await init_workflows(workflows_dir());
  const loaded = get_run(run_id)?.summary;
  assert.equal(loaded?.status, "interrupted");
  assert.equal(loaded?.agents[0]?.status, "interrupted");
  assert.equal(loaded?.error, app_closed_text);
  assert.ok(has_agent_notes("chat-crash"));
  const notes = take_agent_notes("chat-crash");
  assert.match(notes[0]?.text ?? "", /Workflow crashed \(run wf_00000000-crash-0001\) ended with status interrupted/);
  await writes_settled(path.join(run_dir(run_id), "state.json"));
  const saved = JSON.parse(await fs.readFile(path.join(run_dir(run_id), "state.json"), "utf8")) as { summary: { status: string } };
  assert.equal(saved.summary.status, "interrupted");
});

test("deleting the chat stops its workflows without a notice and removes their data", async () => {
  scripts.set("wf until delete", block_until_abort);
  const started = await launch("chat-delete", "return await agent('wf until delete')");
  const run_id = started.summary.run_id;
  await wait_until(() => summary(run_id).agents[0]?.status === "running", "the agent to run");
  await clear_chat_workflows("chat-delete");
  assert.equal(get_run(run_id), null);
  await assert.rejects(fs.stat(run_dir(run_id)));
  await wait_until(() => live_runs().every((live) => live.chat_id !== "chat-delete"), "the agent run to end");
  assert.equal(workflow_notices.some((notice) => notice.run_id === run_id), false);
  assert.equal(has_agent_notes("chat-delete"), false);
});
