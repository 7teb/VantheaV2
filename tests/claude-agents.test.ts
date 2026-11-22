import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ModelEntry } from "../shared/models.ts";
import type { Settings } from "../shared/settings.ts";
import { parse_index } from "../electron/agents/records.ts";
import { set_agent_continuation, type AgentReport } from "../electron/agents/reports.ts";
import { clear_chat_agents, continue_agent, deploy_agent, init_agents, type DeployRequest, type RunContext } from "../electron/agents/runner.ts";
import { get_agent } from "../electron/agents/store.ts";
import { claude_runtime, set_claude_runtime, type ClaudeRuntime } from "../electron/claude/runtime.ts";
import type { ApiMessage, RoundResult } from "../electron/model/types.ts";
import { run_claude_turn } from "../electron/turn/claude/drive.ts";
import { init_settings, update_settings } from "../electron/settings/store.ts";
import type { SecretCodec } from "../electron/storage/secrets.ts";
import { writes_settled } from "../electron/storage/json-file.ts";
import { claude_model, fake_runtime, init, result, text_response, type FakeRuntime } from "./claude-turn-kit.ts";
import { review_stub } from "./review-stub.ts";

const plain_model: ModelEntry = { ...claude_model, id: "test/plain", claude_code: undefined, label: "Plain" };

const settings = { custom_instructions: "", web_search: { topic: "general" } } as Settings;

const codec: SecretCodec = { available: () => true, encrypt: (plain) => plain, decrypt: (cipher) => cipher };

const chat_id = "chat-claude-agents";

const reports: AgentReport[] = [];

const streamed: ApiMessage[][] = [];

let root = "";
let project = "";
let fake: FakeRuntime = fake_runtime();
let previous_runtime: ClaudeRuntime | null = null;

const answered = (content: string): RoundResult => ({ status: "completed", content, reasoning: "", reasoning_details: [], tool_calls: [], finish_reason: "stop", usage: null });

const context = (prompt: string): RunContext => ({
  chat_id,
  parent_message_id: "parent-msg",
  parent_call_id: "parent-call",
  project_root: project,
  user_request: "the user's request",
  mode: "auto",
  settings,
  prompt,
});

const deploy = (prompt: string): DeployRequest => ({
  ...context(prompt),
  name: "Researcher",
  description: "looks things up",
  topic: "",
  scope: [],
  profile: "explore",
  without_tools: [],
  effort: "high",
  model: claude_model,
});

const wait_for = async (check: () => boolean, label: string) => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
};

const reported = (run_id: string) => wait_for(() => reports.some((report) => report.run_id === run_id), `the report of ${run_id}`);

const block_texts = (content: unknown): string[] => (Array.isArray(content) ? content.flatMap((block: { type: string; text?: string }) => (block.type === "text" && block.text ? [block.text] : [])) : []);

const texts = (messages: ApiMessage[]): string[] => messages.flatMap((message) => (typeof message.content === "string" ? [message.content] : block_texts(message.content)));

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-tmp-claude-agents-"));
  project = path.join(root, "project");
  await fs.mkdir(project);
  const dir = path.join(root, "v2");
  await fs.mkdir(dir, { recursive: true });
  await init_settings({ files: { settings: path.join(dir, "settings.json"), secrets: path.join(dir, "secrets.json"), legacy_settings: path.join(root, "settings.json") }, codec, on_change: () => undefined });
  await update_settings({ claude_billing: "claude" });
  previous_runtime = claude_runtime();
  set_claude_runtime(fake.runtime);
  await init_agents({
    dir: path.join(root, "agents"),
    stream: async (request, callbacks) => {
      streamed.push(request.messages);
      callbacks.on_text("Summary from the plain engine");
      return answered("Summary from the plain engine");
    },
    resolve_tools: () => [],
    side_model: async () => "",
    review_call: review_stub().call,
    models: async () => [claude_model, plain_model],
    claude_turn: run_claude_turn,
  });
  set_agent_continuation((notice) => {
    if (notice.kind === "report") {
      reports.push(notice.report);
    }
  });
});

after(async () => {
  if (previous_runtime) {
    set_claude_runtime(previous_runtime);
  }
  await writes_settled(path.join(root, "agents", "index.json"));
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("an agent on a Claude-plan model runs through Claude Code, resumes its session, continues on the normal engine and deletes the session on removal", async () => {
  const first = deploy_agent(deploy("Investigate the parser."));
  const opening = await fake.opened(1);
  const sent = await opening.next_push();
  assert.equal(block_texts(sent.message.content)[0], "Investigate the parser.");
  assert.equal(opening.options.resume, undefined);
  assert.equal(opening.options.title, "Researcher");
  assert.equal(opening.options.cwd, project);
  opening.send(init("sess-agent"), ...text_response("m1", "The parser drops trailing commas."), result());
  await reported(first.run.run_id);
  assert.equal(streamed.length, 0);
  const agent = get_agent(first.agent.agent_id);
  assert.ok(agent);
  assert.deepEqual(agent.claude_session, { session_id: "sess-agent", cwd: project, through_message_id: first.run.run_id });
  assert.equal(reports.find((report) => report.run_id === first.run.run_id)?.status, "completed");

  const second = await continue_agent(agent, context("Check the tokenizer as well."));
  const resumed = await fake.opened(2);
  assert.equal(resumed.options.resume, "sess-agent");
  const continued = await resumed.next_push();
  const continued_texts = block_texts(continued.message.content);
  assert.equal(continued_texts[0], "Check the tokenizer as well.");
  assert.equal(continued_texts.some((text) => text.includes("Earlier conversation of this chat")), false);
  resumed.send(init("sess-agent"), ...text_response("m2", "The tokenizer is fine."), result());
  await reported(second.run.run_id);
  assert.equal(streamed.length, 0);
  assert.deepEqual(get_agent(agent.agent_id)?.claude_session, { session_id: "sess-agent", cwd: project, through_message_id: second.run.run_id });

  await update_settings({ claude_billing: "api" });
  try {
    const third = await continue_agent(agent, context("Summarize what you found."));
    await reported(third.run.run_id);
  } finally {
    await update_settings({ claude_billing: "claude" });
  }
  assert.equal(fake.queries.length, 2);
  assert.equal(streamed.length, 1);
  const carried = texts(streamed[0] ?? []);
  for (const expected of ["Investigate the parser.", "The parser drops trailing commas.", "Check the tokenizer as well.", "The tokenizer is fine.", "Summarize what you found."]) {
    assert.ok(carried.includes(expected), `${expected} is missing from the context the normal engine got: ${JSON.stringify(carried)}`);
  }

  await clear_chat_agents(chat_id);
  assert.deepEqual(fake.deleted, [{ session_id: "sess-agent", cwd: project }]);
  assert.equal(get_agent(agent.agent_id), null);
});

test("an agent whose stored session does not cover its previous run starts a new seeded session and deletes the old one", async () => {
  fake = fake_runtime();
  set_claude_runtime(fake.runtime);
  const first = deploy_agent(deploy("Map the modules."));
  const opening = await fake.opened(1);
  await opening.next_push();
  opening.send(init("sess-old"), ...text_response("m1", "Three modules."), result());
  await reported(first.run.run_id);
  const agent = get_agent(first.agent.agent_id);
  assert.ok(agent);
  await update_settings({ claude_billing: "api" });
  try {
    const plain = await continue_agent(agent, context("List them."));
    await reported(plain.run.run_id);
  } finally {
    await update_settings({ claude_billing: "claude" });
  }
  const third = await continue_agent(agent, context("Now describe the first one."));
  const seeded = await fake.opened(2);
  assert.equal(seeded.options.resume, undefined);
  assert.deepEqual(fake.deleted, [{ session_id: "sess-old", cwd: project }]);
  const sent = block_texts((await seeded.next_push()).message.content);
  assert.match(sent[0] ?? "", /Earlier conversation of this chat/);
  assert.match(sent[0] ?? "", /Three modules\./);
  assert.equal(sent[1], "Now describe the first one.");
  seeded.send(init("sess-new"), ...text_response("m2", "The first one parses."), result());
  await reported(third.run.run_id);
  assert.deepEqual(get_agent(agent.agent_id)?.claude_session, { session_id: "sess-new", cwd: project, through_message_id: third.run.run_id });
  await clear_chat_agents(chat_id);
  assert.deepEqual(fake.deleted.at(-1), { session_id: "sess-new", cwd: project });
});

test("the agent index keeps a complete Claude Code session pointer and drops a malformed one", () => {
  const now = "2026-11-21T10:00:00.000Z";
  const record = (claude_session: unknown) => ({ agent_id: "agent_a", chat_id, name: "A", runs: [], claude_session });
  const ref = { session_id: "s", cwd: "C:/p", through_message_id: "run_1" };
  assert.deepEqual(parse_index({ agents: [record(ref)] }, now).records[0]?.claude_session, ref);
  const broken = parse_index({ agents: [record({ session_id: "s", cwd: "" })] }, now).records[0];
  assert.ok(broken);
  assert.equal("claude_session" in broken, false);
});

test("an agent on a Claude-plan model fails without the Claude Code driver instead of falling back to OpenRouter", async () => {
  await init_agents({
    dir: path.join(root, "agents-without-driver"),
    stream: async (request) => {
      streamed.push(request.messages);
      return answered("must not run");
    },
    resolve_tools: () => [],
    side_model: async () => "",
    review_call: review_stub().call,
    models: async () => [claude_model, plain_model],
  });
  const streams = streamed.length;
  const queries = fake.queries.length;
  const started = deploy_agent(deploy("Look around."));
  await reported(started.run.run_id);
  assert.equal(reports.find((report) => report.run_id === started.run.run_id)?.status, "failed");
  assert.deepEqual([streamed.length, fake.queries.length], [streams, queries]);
  await clear_chat_agents(chat_id);
});
