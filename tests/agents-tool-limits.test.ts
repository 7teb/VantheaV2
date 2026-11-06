import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { report_event_context, report_event_text } from "../shared/agent-notes.ts";
import type { ApprovalRequest } from "../shared/approval.ts";
import type { ModelEntry } from "../shared/models.ts";
import { live_run } from "../electron/agents/live.ts";
import { agent_role_section } from "../electron/agents/prompt.ts";
import { parse_index, public_summary } from "../electron/agents/records.ts";
import { report_seconds } from "../electron/agents/reports.ts";
import { label_of, profile_text, roster_entries, roster_text } from "../electron/agents/roster.ts";
import { deploy_agent } from "../electron/agents/runner.ts";
import { reminder_interval } from "../electron/agents/session.ts";
import { chat_agents, get_agent, init_agent_store, list_agents, save_index_sync } from "../electron/agents/store.ts";
import { compose_sections, type SectionInput } from "../electron/prompts/sections.ts";
import { get_agent_status_tool } from "../electron/tools/agents/manage.ts";
import { message_main_agent_tool } from "../electron/tools/agents/message-main.ts";
import { continue_agent_tool, deploy_agent_tool } from "../electron/tools/agents/start.ts";
import type { Tool, ToolContext, ToolProfile } from "../electron/tools/types.ts";
import { register_active, unregister_active } from "../electron/turn/active.ts";
import { completed, events, model, offered, project, reports, request, root, scripts, settings, start_runner, stop_runner, tools, updates, wait_for } from "./agents-runner-harness.ts";
import { answer, review_stub, type ReviewStub } from "./review-stub.ts";

const ran: string[] = [];

const fake_tool = (name: string, profiles: ToolProfile[]): Tool => ({
  spec: { name, description: `${name} for tests`, parameters: { type: "object", properties: {} } },
  profiles,
  available: () => true,
  execute: async () => {
    ran.push(name);
    return { status: "done", text: `${name} ran`, view: null };
  },
});

before(async () => {
  await start_runner();
  tools.push(fake_tool("read_file", ["main", "explore", "worker"]), fake_tool("run_command", ["main", "worker"]), fake_tool("run_bash", ["main", "worker"]));
});

after(stop_runner);

const main_ctx = (chat_id: string, review: ReviewStub): ToolContext => ({
  chat_id,
  turn_id: `turn-${chat_id}`,
  call_id: `call-${chat_id}`,
  project_root: project,
  user_request: "read the parser but do not run anything",
  mode: "ask",
  profile: "main",
  model,
  image_fit: [],
  settings,
  signal: new AbortController().signal,
  progress: () => undefined,
  approve: async () => ({ approved: true, grant: "once", feedback: "" }),
  side_model: async () => "",
  review,
  message_main: null,
  send_peer: null, context: () => ({ used: 0, limit: 0, compact_at: null }),
});

const deploy_args = (prompt: string, extra: Record<string, unknown>) => ({ name: "Reader", description: "reads the parser", topic: "parser", prompt, profile: "worker", ...extra });

const reviewed = (stub: ReviewStub) => stub.calls[0]?.parts.at(-1)?.text ?? "";

const with_turn = async (chat_id: string, work: () => Promise<void>) => {
  register_active(chat_id, `turn-${chat_id}`, () => undefined, model, "");
  try {
    await work();
  } finally {
    unregister_active(chat_id, `turn-${chat_id}`);
  }
};

const reported = (run_id: string) => wait_for(() => reports.some((report) => report.run_id === run_id));

test("deploy_agent rejects a name the profile does not have before the review and lists the profile's tools", () =>
  with_turn("chat-limits-unknown", async () => {
    const stub = review_stub();
    const result = await deploy_agent_tool.execute(main_ctx("chat-limits-unknown", stub), deploy_args("unknown names", { without_tools: ["run_command", "browser_click"] }));
    assert.equal(result.status, "failed");
    assert.match(result.text, /without_tools can only remove tools of the worker profile; browser_click is not among them\./);
    assert.ok(result.text.includes("Tools of the worker profile: read_file, run_command, run_bash."), result.text);
    assert.equal(stub.calls.length, 0);
    assert.equal(chat_agents("chat-limits-unknown").length, 0);
    await assert.rejects(async () => deploy_agent_tool.execute(main_ctx("chat-limits-unknown", stub), deploy_args("not a list", { without_tools: "run_command" })), /without_tools must be a list of strings/);
    assert.equal(chat_agents("chat-limits-unknown").length, 0);
  }));

test("a restricted deploy stores the list once, shows it to the review, the roster, get_agent_status and the summary, and filters the offered tools", () =>
  with_turn("chat-limits-deploy", async () => {
    const prompt = "read only please";
    let system = "";
    scripts.set(prompt, async (messages) => {
      system = String(messages[0]?.content);
      return completed({ content: "read everything" });
    });
    const stub = review_stub([answer("allow")]);
    const result = await deploy_agent_tool.execute(main_ctx("chat-limits-deploy", stub), deploy_args(prompt, { without_tools: ["run_command", "run_bash", "run_command"] }));
    assert.equal(result.status, "done", result.text);
    assert.match(result.text, /\(id agent_[\w-]+, worker \(without run_command, run_bash\), model test\/model, topic parser\)/);
    assert.ok(reviewed(stub).includes("deploy_agent, new sub-agent Reader, profile worker (without run_command, run_bash), model test/model"), reviewed(stub));
    const [agent] = chat_agents("chat-limits-deploy");
    assert.ok(agent);
    assert.deepEqual(agent.without_tools, ["run_command", "run_bash"]);
    assert.deepEqual(list_agents("chat-limits-deploy")[0]?.without_tools, ["run_command", "run_bash"]);
    const run_id = agent.runs.at(-1)?.run_id ?? "";
    await wait_for(() => live_run(run_id) === null);
    assert.deepEqual(offered.get(prompt), [1]);
    assert.ok(system.includes("The main agent removed these tools from your profile for this agent: run_command, run_bash."), system.slice(-2000));
    assert.ok(roster_text(roster_entries("chat-limits-deploy"), null).includes(`${label_of(agent)}, topic parser, worker (without run_command, run_bash), completed`));
    const status = await get_agent_status_tool.execute(main_ctx("chat-limits-deploy", review_stub()), { agent_id: agent.agent_id });
    assert.ok(status.text.startsWith(`Agent ${label_of(agent)} (${agent.agent_id}, "Reader"), worker (without run_command, run_bash), model test/model.`), status.text.slice(0, 300));
  }));

test("a call to a removed tool is refused at execution and never runs, while the running roster shows the restriction", async () => {
  const chat_id = "chat-limits-refuse";
  const prompt = "try the shell";
  let round = 0;
  let running_roster = "";
  scripts.set(prompt, async () => {
    round += 1;
    if (round === 1) {
      return completed({
        tool_calls: [
          { index: 0, id: "p0", name: "run_command", arguments: "{}" },
          { index: 1, id: "p1", name: "made_up", arguments: "{}" },
        ],
        finish_reason: "tool_calls",
      });
    }
    running_roster = roster_text(roster_entries(chat_id), null);
    return completed({ content: "could not run commands" });
  });
  const started = deploy_agent(request(prompt, { chat_id, name: "Shell", without_tools: ["run_command"] }));
  await reported(started.run.run_id);
  const ends = events.flatMap((event) => (event.run_id === started.run.run_id && event.type === "tool_end" ? [event] : []));
  assert.deepEqual(
    ends.map((event) => [event.status, event.result_text]),
    [
      ["failed", "run_command was removed from your tools by the main agent, so the call did not run. Continue without it; if the task cannot be done without it, report that as a blocker."],
      ["failed", "Unknown tool: made_up"],
    ],
  );
  assert.deepEqual(ran, []);
  assert.deepEqual(offered.get(prompt), [2, 2]);
  assert.match(running_roster, /Shell#\w+, topic none, no scope, worker \(without run_command\), model test\/model, running since/);
});

test("the restriction survives a reload from disk and applies to continue_agent runs, whose review sees it", async () => {
  const chat_id = "chat-limits-continue";
  const prompt = "first look";
  const systems: string[] = [];
  scripts.set(prompt, async (messages) => {
    systems.push(String(messages[0]?.content));
    return completed({ content: `report ${systems.length}` });
  });
  const started = deploy_agent(request(prompt, { chat_id, name: "Keeper", topic: "parser", without_tools: ["run_bash"] }));
  await reported(started.run.run_id);
  save_index_sync();
  const stored = JSON.parse(await fs.readFile(path.join(root, "agents", "index.json"), "utf8")) as { agents: { agent_id: string; without_tools?: unknown }[] };
  assert.deepEqual(stored.agents.find((entry) => entry.agent_id === started.agent.agent_id)?.without_tools, ["run_bash"]);
  await init_agent_store(path.join(root, "agents"));
  const loaded = get_agent(started.agent.agent_id);
  assert.ok(loaded);
  assert.deepEqual(loaded.without_tools, ["run_bash"]);
  const stub = review_stub([answer("allow")]);
  const result = await continue_agent_tool.execute(main_ctx(chat_id, stub), { agent_id: loaded.agent_id, prompt: "look again" });
  assert.equal(result.status, "done", result.text);
  assert.ok(reviewed(stub).includes(`continue_agent, sub-agent ${label_of(loaded)}, profile worker (without run_bash), model test/model`), reviewed(stub));
  const continued_run = get_agent(loaded.agent_id)?.runs.at(-1)?.run_id ?? "";
  await reported(continued_run);
  assert.deepEqual(offered.get(prompt), [2, 2]);
  assert.equal(systems.length, 2);
  for (const system of systems) {
    assert.ok(system.includes("The main agent removed these tools from your profile for this agent: run_bash."));
  }
  for (const run_id of [started.run.run_id, continued_run]) {
    const report = reports.find((entry) => entry.run_id === run_id);
    assert.ok(report);
    assert.equal(report.profile, "worker (without run_bash)");
    const text = report_event_text({ ...report, seconds: report_seconds(report) });
    assert.ok(text.includes("\n\nProfile: worker (without run_bash)\n\n"), text);
    assert.ok(report_event_context(text).includes("\n\nProfile: worker (without run_bash)\n\n"));
  }
});

test("a reviewed deploy_agent and continue_agent card names the removed tools", () =>
  with_turn("chat-limits-card", async () => {
    const prompt = "card first";
    scripts.set(prompt, async () => completed({ content: "carded report" }));
    const asked: ApprovalRequest[] = [];
    const carded = (reason: string): ToolContext => ({
      ...main_ctx("chat-limits-card", review_stub([answer("review", reason)])),
      approve: async (request) => {
        asked.push(request);
        return { approved: true, grant: "once", feedback: "" };
      },
    });
    const deployed = await deploy_agent_tool.execute(carded("a worker without a shell"), deploy_args(prompt, { without_tools: ["run_command", "run_bash"] }));
    assert.equal(deployed.status, "done", deployed.text);
    const [agent] = chat_agents("chat-limits-card");
    assert.ok(agent);
    const first_run = agent.runs.at(-1)?.run_id ?? "";
    await wait_for(() => live_run(first_run) === null);
    const continued = await continue_agent_tool.execute(carded("same worker again"), { agent_id: agent.agent_id, prompt: "card again" });
    assert.equal(continued.status, "done", continued.text);
    const second_run = get_agent(agent.agent_id)?.runs.at(-1)?.run_id ?? "";
    await wait_for(() => live_run(second_run) === null);
    assert.deepEqual(
      asked.map((request) => (request.kind === "agent_message" ? [request.tool, request.about, request.without_tools, request.review?.reason] : [request.kind])),
      [
        ["deploy_agent", "parser", ["run_command", "run_bash"], "a worker without a shell"],
        ["continue_agent", "parser", ["run_command", "run_bash"], "same worker again"],
      ],
    );
  }));

test("records stored before without_tools existed load with no tools removed", () => {
  const { records } = parse_index(
    {
      agents: [
        { agent_id: "agent_old", chat_id: "c", name: "Old", profile: "worker", runs: [] },
        { agent_id: "agent_mixed", chat_id: "c", name: "Mixed", profile: "worker", without_tools: ["run_command", 7, null], runs: [] },
      ],
    },
    "2026-10-15T10:00:00.000Z",
  );
  const old = records.find((record) => record.agent_id === "agent_old");
  const mixed = records.find((record) => record.agent_id === "agent_mixed");
  assert.ok(old && mixed);
  assert.deepEqual(old.without_tools, []);
  assert.deepEqual(public_summary(old).without_tools, []);
  assert.equal(profile_text(old), "worker");
  assert.equal(agent_role_section(old).body.includes("removed these tools"), false);
  assert.deepEqual(mixed.without_tools, ["run_command"]);
  assert.equal(profile_text(mixed), "worker (without run_command)");
});

const section_model: ModelEntry = { ...model, id: "test/main" };

const section_input = (names: string[]): SectionInput => ({
  model: section_model,
  mode: "auto",
  plan: false,
  personality: "pragmatic",
  project_root: "C:/proj",
  scratchpad: null,
  project_docs: [],
  listing: "",
  custom_instructions: "",
  tool_names: new Set(names),
  user_attachments: false,
  major: false,
  deferred_mcp: [],
});

test("the main agent learns when to use without_tools and the parameter stays optional", () => {
  const body = compose_sections(section_input(["deploy_agent"])).find((section) => section.title === "sub_agents")?.body ?? "";
  assert.match(body, /without_tools takes tools away from the chosen profile for that agent, for example run_command and run_bash for a worker that may only read and edit files; use it only when the user asks for it or the task clearly requires that the agent must not use a tool\./);
  const parameters = deploy_agent_tool.spec.parameters;
  assert.deepEqual(parameters.properties.without_tools, {
    type: "array",
    items: { type: "string" },
    description: (parameters.properties.without_tools as { description: string }).description,
  });
  assert.equal(parameters.required?.includes("without_tools"), false);
  assert.match(continue_agent_tool.spec.description, /Tools removed with without_tools stay removed\.$/);
});

test("an agent without message_main_agent gets no update reminder after many silent tool calls and cannot send updates", async () => {
  const chat_id = "chat-limits-silent";
  const prompt = "work silently";
  const probe = fake_tool("probe", ["worker"]);
  tools.push(probe, message_main_agent_tool);
  const reminded: boolean[] = [];
  const probes = (first: number) => Array.from({ length: reminder_interval }, (_, index) => ({ index, id: `s${first + index}`, name: "probe", arguments: "{}" }));
  let round = 0;
  scripts.set(prompt, async (messages) => {
    round += 1;
    reminded.push(messages.some((message) => message.role === "user" && typeof message.content === "string" && message.content.includes("since the main agent last heard from you")));
    if (round <= 2) {
      return completed({ tool_calls: probes(round * 100), finish_reason: "tool_calls" });
    }
    if (round === 3) {
      return completed({ tool_calls: [{ index: 0, id: "m0", name: "message_main_agent", arguments: JSON.stringify({ text: "found it" }) }], finish_reason: "tool_calls" });
    }
    return completed({ content: "done without updates" });
  });
  try {
    const started = deploy_agent(request(prompt, { chat_id, name: "Silent", without_tools: ["message_main_agent"] }));
    await reported(started.run.run_id);
    assert.deepEqual(reminded, [false, false, false, false]);
    assert.equal(events.filter((event) => event.run_id === started.run.run_id && event.type === "notice" && event.notice === "update_reminder").length, 0);
    const refused = events.find((event) => event.run_id === started.run.run_id && event.type === "tool_end" && event.status === "failed");
    assert.equal(refused?.type === "tool_end" ? refused.result_text : "", "message_main_agent was removed from your tools by the main agent, so the call did not run. Continue without it; if the task cannot be done without it, report that as a blocker.");
    assert.equal(updates.some((entry) => entry.run_id === started.run.run_id), false);
    assert.deepEqual(offered.get(prompt), [4, 4, 4, 4]);
  } finally {
    tools.splice(tools.indexOf(probe), 2);
  }
});
