import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AgentEvent } from "../shared/events.ts";
import type { ModelEntry } from "../shared/models.ts";
import { on_agent_event } from "../electron/agents/live.ts";
import { set_agent_continuation, type AgentReport } from "../electron/agents/reports.ts";
import { deploy_agent, init_agents, type DeployRequest } from "../electron/agents/runner.ts";
import { compaction_request, resume_text } from "../electron/context/compact-text.ts";
import type { ApiMessage, ApiUserMessage, RoundRequest } from "../electron/model/types.ts";
import type { Tool } from "../electron/tools/types.ts";
import type { StreamFn } from "../electron/turn/session.ts";
import { completed, settings, wait_for } from "./agents-runner-harness.ts";
import { review_stub } from "./review-stub.ts";
import { is_note_call } from "./turn-compaction-harness.ts";

const model: ModelEntry = {
  id: "test/model",
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

const note = "TASK: find the bug\nFINDINGS: src/a.ts:3 divides by zero\nNEXT: write the report";

const read_tool: Tool = {
  spec: { name: "read_file", description: "", parameters: { type: "object", properties: {} } },
  profiles: ["explore", "worker"],
  available: () => true,
  execute: async () => ({ status: "done", text: "const a = 1 / 0;", view: null }),
};

const requests: { request: RoundRequest; messages: ApiMessage[] }[] = [];

const reports: AgentReport[] = [];

const events: AgentEvent[] = [];

let root = "";

const stream: StreamFn = async (request, callbacks) => {
  requests.push({ request, messages: request.messages.map((message) => ({ ...message })) });
  if (is_note_call(request)) {
    return completed({ content: note });
  }
  if (!request.messages.some((message) => message.role === "tool")) {
    return completed({ tool_calls: [{ index: 0, id: "p0", name: "read_file", arguments: "{}" }], finish_reason: "tool_calls", usage: { prompt_tokens: 75_000, completion_tokens: 20, reasoning_tokens: 0 } });
  }
  callbacks.on_text("Report: src/a.ts:3 divides by zero.");
  return completed({ content: "Report: src/a.ts:3 divides by zero." });
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-agent-compaction-"));
  await fs.mkdir(path.join(root, "project"));
  await init_agents({
    dir: path.join(root, "agents"),
    stream,
    resolve_tools: (profile) => [read_tool].filter((tool) => tool.profiles.includes(profile)),
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
  chat_id: "chat-compaction",
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

test("a read-only sub-agent compacts its own context with the sub-agent note and keeps its delegated task", async () => {
  const started = deploy_agent(deploy("Find why the build divides by zero."));
  await wait_for(() => reports.some((report) => report.run_id === started.run.run_id));
  assert.equal(reports.find((report) => report.run_id === started.run.run_id)?.status, "completed");
  assert.equal(requests.length, 3);
  const note_request = requests[1]?.request;
  assert.equal(note_request?.tool_choice, undefined);
  assert.equal(note_request?.model.id, model.id);
  assert.deepEqual(note_request?.tools.map((tool) => tool.name), ["read_file"]);
  assert.equal(requests[1]?.messages.at(-1)?.content, compaction_request("agent"));
  const after = requests[2]?.messages ?? [];
  assert.equal(after[1]?.content, `${resume_text("agent")}\n\n${note}`);
  assert.ok(after.some((message) => message.role === "user" && (message as ApiUserMessage).instruction && message.content === "Find why the build divides by zero."));
  const run_events = events.filter((event) => event.run_id === started.run.run_id);
  assert.deepEqual(
    run_events.flatMap((event) => (event.type === "compaction" ? [`${event.status}:${event.source}`] : [])),
    ["running:auto", "done:auto"],
  );
  assert.equal(run_events.some((event) => event.type === "tool_approval"), false);
  const context = JSON.parse(await fs.readFile(path.join(root, "agents", started.agent.agent_id, "context.json"), "utf8")) as ApiMessage[];
  assert.equal(context[0]?.role === "user" && context[0].compaction, true);
  assert.equal(context[0]?.content, `${resume_text("agent")}\n\n${note}`);
});
