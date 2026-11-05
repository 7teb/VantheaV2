import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { live_runs } from "../electron/agents/live.ts";
import { take_agent_notes } from "../electron/agents/reports.ts";
import { continue_agent, deploy_agent, max_running_agents } from "../electron/agents/runner.ts";
import { get_agent } from "../electron/agents/store.ts";
import { live_workflow } from "../electron/workflows/live.ts";
import { stop_chat_workflows, stop_workflow_run } from "../electron/workflows/runtime.ts";
import { read_calls, user_saved_dir } from "../electron/workflows/store.ts";
import { block_until_abort, completed, request, scripts, stop_runner, workflow_notices } from "./agents-runner-harness.ts";
import { contents, ended, launch, launch_source, sleep, start_workflows, summary, wait_until } from "./workflow-run-kit.ts";

before(start_workflows);

after(stop_runner);

const calls = new Map<string, number>();

const counted = (prompt: string, content: string) =>
  scripts.set(prompt, async () => {
    calls.set(prompt, (calls.get(prompt) ?? 0) + 1);
    return completed({ content });
  });

const stop_if_running = async (run_id: string): Promise<string> => {
  const state = summary(run_id).status;
  if (state === "running") {
    stop_workflow_run(run_id, "main");
    await ended(run_id);
  }
  return state;
};

test("a script that returns without awaiting anything completes and the main agent gets its value", async () => {
  const started = await launch("chat-atk2-instant", "return 42");
  assert.equal(started.start_error, null);
  const done = await ended(started.summary.run_id);
  assert.equal(done.status, "completed");
  await wait_until(() => workflow_notices.some((notice) => notice.run_id === done.run_id), "the result notice");
  assert.match(workflow_notices.find((notice) => notice.run_id === done.run_id)?.text ?? "", /\n42$/);
});

test("several done calls forged through Promise.prototype.then end the run once with one notice", async () => {
  const forged = "const then = Promise.prototype.then\nPromise.prototype.then = function (ok, bad) { if (typeof ok === 'function' && typeof bad === 'function') { ok('forged one'); ok('forged two') } return then.call(this, ok, bad) }\nreturn 'real'";
  const done = await ended((await launch("chat-atk2-then", forged)).summary.run_id);
  assert.equal(done.status, "completed");
  await sleep(100);
  assert.equal(workflow_notices.filter((notice) => notice.run_id === done.run_id).length, 1);
});

test("a script that awaits a promise nothing can settle ends instead of running forever", async () => {
  const started = await launch("chat-atk2-deadlock", "log('before')\nawait new Promise(() => {})\nreturn 'never'");
  await sleep(1500);
  const state = await stop_if_running(started.summary.run_id);
  assert.notEqual(state, "running", "the script has no open agent() or workflow() call and no pending job, so nothing can ever resume it");
});

test("a script that broke its own Map so agent() never settles ends once every call has settled", async () => {
  scripts.set("wf atk2 map", async () => completed({ content: "m" }));
  const started = await launch("chat-atk2-map", "Map.prototype.get = () => undefined\nconst value = await agent('wf atk2 map')\nreturn value");
  const run_id = started.summary.run_id;
  await wait_until(() => summary(run_id).agents[0]?.status === "completed", "the agent to finish");
  await sleep(800);
  const state = await stop_if_running(run_id);
  take_agent_notes("chat-atk2-map");
  assert.notEqual(state, "running", "every agent call settled and the sandbox has no pending job left");
});

test("opts.phase with a blank title is refused like phase('') instead of creating an untitled group", async () => {
  scripts.set("wf atk2 blank", async () => completed({ content: "b" }));
  const started = await launch("chat-atk2-blank", "let problem = ''\ntry { await agent('wf atk2 blank', { phase: '  ' }) } catch (error) { problem = String(error) }\ntry { phase('  ') } catch (error) { problem += ' | ' + String(error) }\nreturn problem");
  const done = await ended(started.summary.run_id);
  const titles = done.phases.map((phase) => phase.title);
  assert.ok(titles.every((title) => title.trim() !== ""), `phase titles: ${JSON.stringify(titles)}`);
  assert.equal(live_workflow(done.run_id), null);
});

test("a saved child workflow's agents use the child's own role even when the parent defines one with the same name", async () => {
  let system = "";
  scripts.set("wf atk2 child judge", async (messages) => {
    system = contents(messages)[0] ?? "";
    return completed({ content: "judged" });
  });
  await fs.mkdir(user_saved_dir(), { recursive: true });
  await fs.writeFile(
    path.join(user_saved_dir(), "atk2-child.js"),
    "export const meta = { name: 'atk2-child', description: 'child with its own judge', roles: { judge: { profile: 'explore', instructions: 'CHILD JUDGE RULES' } } }\nreturn await agent('wf atk2 child judge', { role: 'judge' })",
  );
  const source = [
    "export const meta = { name: 'atk2-parent', description: 'parent with another judge', roles: { judge: { profile: 'worker', instructions: 'PARENT JUDGE RULES' } } }",
    "return await workflow('atk2-child')",
  ].join("\n");
  const done = await ended((await launch_source("chat-atk2-child-role", source)).summary.run_id);
  assert.equal(done.status, "completed");
  assert.match(system, /CHILD JUDGE RULES/, "the child's agent ran with the instructions of the parent's role of the same name");
  assert.match(system, /Your profile is explore/);
});

test("continuing a finished workflow agent counts against the 20-agent limit of continue_agent", async () => {
  const chat_id = "chat-atk2-cap";
  scripts.set("wf atk2 cap first", async () => completed({ content: "first" }));
  scripts.set("wf atk2 cap second", async () => completed({ content: "second" }));
  const first = await ended((await launch(chat_id, "return await parallel([() => agent('wf atk2 cap first'), () => agent('wf atk2 cap second')])")).summary.run_id);
  const records = first.agents.map((entry) => get_agent(entry.agent_id ?? ""));
  assert.ok(records.every((record) => record?.workflow));
  for (let index = 0; index < max_running_agents - 1; index += 1) {
    scripts.set(`plain atk2 cap ${index}`, block_until_abort);
    deploy_agent(request(`plain atk2 cap ${index}`, { chat_id }));
  }
  const blocked = new Set<string>();
  for (const prompt of ["wf atk2 cap first", "wf atk2 cap second"]) {
    scripts.set(prompt, async (messages, signal) => {
      blocked.add(prompt);
      return block_until_abort(messages, signal);
    });
  }
  let refused = "";
  try {
    for (const [index, record] of records.entries()) {
      if (record) {
        await continue_agent(record, request(`wf atk2 cap again ${index}`, { chat_id }));
        if (index === 0) await wait_until(() => blocked.size === 1, "the first continued workflow agent to reach its blocked model call");
      }
    }
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  const running = live_runs().filter((entry) => entry.chat_id === chat_id).length;
  for (const live of live_runs().filter((entry) => entry.chat_id === chat_id)) {
    live.controller.abort(new Error("test cleanup"));
  }
  await wait_until(() => live_runs().every((entry) => entry.chat_id !== chat_id), "every run of the chat to end");
  stop_chat_workflows(chat_id, "main");
  assert.match(refused, /At most 20 agents can run at once/, `${running} deploy_agent/continue_agent runs ran at once: a continued workflow agent is not counted because its record still carries the workflow link`);
});

test("a resume of a resumed run is a full cache hit with no model call", async () => {
  counted("wf atk2 chain a", "A");
  counted("wf atk2 chain b", "B");
  const body = "const a = await agent('wf atk2 chain a')\nconst b = await agent('wf atk2 chain b', { label: 'b' })\nreturn a + b";
  const first = await ended((await launch("chat-atk2-chain", body)).summary.run_id);
  const second = await ended((await launch("chat-atk2-chain", body, undefined, { run_id: first.run_id, journal: await read_calls(first.run_id) })).summary.run_id);
  const third = await ended((await launch("chat-atk2-chain", body, undefined, { run_id: second.run_id, journal: await read_calls(second.run_id) })).summary.run_id);
  assert.deepEqual([first.result_preview, second.result_preview, third.result_preview], ['"AB"', '"AB"', '"AB"']);
  assert.deepEqual([calls.get("wf atk2 chain a"), calls.get("wf atk2 chain b")], [1, 1]);
  assert.deepEqual(third.agents.map((agent) => agent.status), ["cached", "cached"]);
});

test("a Stop that arrives while start_workflow still writes the script stops the workflow it was meant for", async () => {
  const chat_id = "chat-atk2-early-stop";
  scripts.set("wf atk2 early", block_until_abort);
  const starting = launch(chat_id, "return await agent('wf atk2 early')");
  const stopped = stop_chat_workflows(chat_id, "user");
  const started = await starting;
  const run_id = started.summary.run_id;
  await sleep(300);
  const state = summary(run_id).status;
  const agents = summary(run_id).agents.length;
  await stop_if_running(run_id);
  take_agent_notes(chat_id);
  assert.deepEqual({ stopped, state, agents }, { stopped: 1, state: "stopped", agents: 0 }, "the chat's Stop came after the approval but before the run was tracked, and the workflow started its agent anyway");
});

const timed_logs = async (chat_id: string, lines: number): Promise<number> => {
  const started_at = performance.now();
  const done = await ended((await launch(chat_id, `for (let i = 0; i < ${lines}; i++) log('line ' + i)\nreturn ${lines}`)).summary.run_id);
  assert.equal(done.logs.length, lines);
  return performance.now() - started_at;
};

test("the host handles a script's log lines in linear time, so a chatty script cannot freeze the main process", async () => {
  const small = await timed_logs("chat-atk2-logs-small", 4000);
  const big = await timed_logs("chat-atk2-logs-big", 32000);
  assert.ok(big < small * 14, `4000 lines took ${Math.round(small)} ms, 32000 lines took ${Math.round(big)} ms on the main thread: every log() copies the whole summary`);
});
