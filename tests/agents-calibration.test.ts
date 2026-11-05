import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, mock, test } from "node:test";
import type { AgentEvent } from "../shared/events.ts";
import type { ContextUsage } from "../shared/chat.ts";
import type { ModelEntry } from "../shared/models.ts";
import { live_run, on_agent_event } from "../electron/agents/live.ts";
import { set_agent_continuation, type AgentReport } from "../electron/agents/reports.ts";
import { cancel_agent, continue_agent, deploy_agent, init_agents, type DeployRequest } from "../electron/agents/runner.ts";
import { get_agent, run_file } from "../electron/agents/store.ts";
import { sent_estimate } from "../electron/context/calibration.ts";
import type { RoundRequest } from "../electron/model/types.ts";
import type { StreamFn } from "../electron/turn/session.ts";
import { completed, settings, wait_for } from "./agents-runner-harness.ts";
import { review_stub } from "./review-stub.ts";
import { is_note_call } from "./turn-compaction-harness.ts";

const model: ModelEntry = {
  id: "test/calibrated",
  label: "Test",
  provider: "p",
  provider_order: [],
  efforts: [],
  default_effort: "",
  vision: false,
  context_length: 100_000,
  max_output: 4096,
  reasoning_passback: false,
};

const reports: AgentReport[] = [];

const events: AgentEvent[] = [];

const requests: { request: RoundRequest; estimate: number }[] = [];

let root = "";

const stream: StreamFn = async (request, callbacks) => {
  const estimate = sent_estimate(request.messages, request.tools, request.model);
  requests.push({ request, estimate });
  if (is_note_call(request)) {
    return completed({ content: "TASK: t\nFINDINGS: none" });
  }
  callbacks.on_text("Report: done.");
  return completed({ content: "Report: done.", usage: { prompt_tokens: Math.round(estimate * 1.15), completion_tokens: 10, reasoning_tokens: 0 } });
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-agent-calibration-"));
  await fs.mkdir(path.join(root, "project"));
  await init_agents({
    dir: path.join(root, "agents"),
    stream,
    resolve_tools: () => [],
    side_model: async () => "",
    review_call: review_stub().call,
    models: async () => [model],
  });
  set_agent_continuation((notice) => {
    if (notice.kind === "report") {
      reports.push(notice.report);
    }
  });
  on_agent_event((event) => events.push(event));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const deploy = (prompt: string): DeployRequest => ({
  chat_id: "chat-calibration",
  parent_message_id: "parent-msg",
  parent_call_id: "parent-call",
  project_root: path.join(root, "project"),
  user_request: "the user's request",
  mode: "ask",
  settings,
  prompt,
  name: "Scout",
  description: "reads code",
  topic: "",
  scope: [],
  profile: "explore",
  without_tools: [],
  effort: "",
  model,
});

const run_contexts = (run_id: string): ContextUsage[] => events.flatMap((event) => (event.run_id === run_id && event.type === "context" ? [event.usage] : []));

const finished = (run_id: string) => wait_for(() => reports.some((report) => report.run_id === run_id));

test("a deployed agent starts with the estimate, calibrates from its first round and journals the calibration", async () => {
  const started = deploy_agent(deploy("Find the bug."));
  await finished(started.run.run_id);
  const [check, after_round] = run_contexts(started.run.run_id);
  assert.equal(check?.calibration, undefined);
  assert.ok(after_round?.calibration);
  const journal = (await fs.readFile(run_file(started.agent.agent_id, started.run.run_id), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { type: string; usage?: ContextUsage });
  assert.deepEqual(journal.filter((entry) => entry.type === "context").at(-1)?.usage?.calibration, after_round.calibration);
});

test("continue_agent seeds the previous run's calibration and compacts at round 0 once the real count passes 70 percent", async () => {
  const first = deploy_agent(deploy("Find the bug."));
  await finished(first.run.run_id);
  const seeded = run_contexts(first.run.run_id).at(-1)?.calibration;
  assert.ok(seeded);
  const before_count = requests.length;
  const agent = get_agent(first.agent.agent_id);
  assert.ok(agent);
  const base = requests.filter((entry) => !is_note_call(entry.request)).at(-1)?.estimate ?? 0;
  const prompt = `Now check the rest. ${"q".repeat((66_000 - base) * 4)}`;
  const second = await continue_agent(agent, { ...deploy(prompt) });
  await finished(second.run.run_id);
  const [check] = run_contexts(second.run.run_id);
  assert.deepEqual(check?.calibration, seeded);
  assert.ok(check && check.used > model.context_length * 0.7);
  const ran = requests.slice(before_count);
  assert.ok(ran[0] && is_note_call(ran[0].request));
  assert.ok(check.used / (seeded.prompt_tokens / seeded.estimate) < model.context_length * 0.7);
  assert.ok(events.some((event) => event.run_id === second.run.run_id && event.type === "compaction" && event.status === "done" && event.round === 0));
});

test("an unreadable journal of the previous run is logged and the continued run starts without a calibration", async () => {
  const first = deploy_agent(deploy("Find the bug."));
  await finished(first.run.run_id);
  const file = run_file(first.agent.agent_id, first.run.run_id);
  await fs.rm(file);
  await fs.mkdir(file);
  const agent = get_agent(first.agent.agent_id);
  assert.ok(agent);
  const logged = mock.method(console, "error", () => undefined);
  try {
    const second = await continue_agent(agent, { ...deploy("Check again.") });
    await finished(second.run.run_id);
    const [check, after_round] = run_contexts(second.run.run_id);
    assert.equal(check?.calibration, undefined);
    assert.ok(after_round?.calibration);
    assert.ok(logged.mock.calls.some((call) => String(call.arguments[0]).includes(first.run.run_id) && String(call.arguments[0]).includes(first.agent.agent_id)));
  } finally {
    logged.mock.restore();
  }
});

test("a continued run that ended before its first check keeps the floor of the run before it", async () => {
  const first = deploy_agent(deploy(`Read everything. ${"z".repeat(300_000)}`));
  await finished(first.run.run_id);
  const set = run_contexts(first.run.run_id).at(-1);
  assert.ok(set?.calibration && set.floor !== undefined && set.floor > model.context_length * 0.7);
  const agent = get_agent(first.agent.agent_id);
  assert.ok(agent);
  const second = await continue_agent(agent, { ...deploy("Stop.") });
  assert.equal(cancel_agent(agent), true);
  await wait_for(() => live_run(second.run.run_id) === null);
  assert.equal(run_contexts(second.run.run_id).length, 0);
  const before_count = requests.length;
  const third = await continue_agent(agent, { ...deploy("Go on.") });
  await finished(third.run.run_id);
  const [check] = run_contexts(third.run.run_id);
  assert.equal(check?.floor, set.floor);
  assert.deepEqual(check?.calibration, set.calibration);
  assert.ok(check && check.used > model.context_length * 0.7);
  assert.equal(requests.slice(before_count).some((entry) => is_note_call(entry.request)), false);
});
