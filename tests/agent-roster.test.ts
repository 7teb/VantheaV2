import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { create_live, forget_live, live_run } from "../electron/agents/live.ts";
import { ask_question, close_questions_to } from "../electron/agents/questions.ts";
import type { AgentRecord, RunRecord } from "../electron/agents/records.ts";
import { overlaps, roster_delta, roster_entries, roster_text, type RosterEntry } from "../electron/agents/roster.ts";
import { cancel_agent, deploy_agent } from "../electron/agents/runner.ts";
import { find_agent, get_agent } from "../electron/agents/store.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import type { Tool } from "../electron/tools/types.ts";
import { block_until_abort, completed, reports, request, scripts, start_runner, stop_runner, tools, wait_for } from "./agents-runner-harness.ts";

before(start_runner);

after(stop_runner);

const now = Date.parse("2026-10-13T13:17:00");

const record = (agent_id: string, name: string, topic: string, scope: string[] = []): AgentRecord => ({
  agent_id,
  chat_id: "chat-unit",
  name,
  description: `${name} does its part`,
  topic,
  model: "m",
  effort: "",
  profile: "worker",
  without_tools: [],
  project_root: "C:/p",
  created_at: "2026-10-13T13:00:00.000Z",
  updated_at: "2026-10-13T13:00:00.000Z",
  runs: [],
  scope,
  held: [],
});

const run_of = (status: RunRecord["status"], started: string, ended: string | null = null): RunRecord => ({
  run_id: `run_${started}`,
  prompt: "task",
  status,
  started_at: new Date(Date.parse(started)).toISOString(),
  ended_at: ended ? new Date(Date.parse(ended)).toISOString() : null,
  report: "",
  open_questions: 0,
  parent_message_id: "p",
});

const entry = (agent: AgentRecord, run: RunRecord, files: { written?: string[]; read?: string[] } = {}): RosterEntry => ({
  agent,
  run,
  running: run.status === "running",
  written: files.written ?? [],
  read: files.read ?? [],
  questions: [],
});

const tokenizer = record("agent_3f2a91c0-1111-4000-8000-000000000001", "Tokenizer", "parser", ["src/parser/tokens.ts"]);
const parser = record("agent_1a2b3c4d-2222-4000-8000-000000000002", "Parser", "Parser", ["src/parser"]);
const docs = record("agent_9d8c7b6a-3333-4000-8000-000000000003", "Docs", "docs");

const probe: Tool = {
  spec: { name: "probe", description: "", parameters: { type: "object", properties: {} } },
  profiles: ["worker"],
  available: () => true,
  execute: async () => ({ status: "done", text: "probed", view: null }),
};

const probe_call = (id: string) => ({ index: 0, id, name: "probe", arguments: "{}" });

const last_user = (messages: ApiMessage[]) => {
  const last = messages.at(-1);
  return last?.role === "user" && typeof last.content === "string" ? last.content : "";
};

test("the roster names the main agent, marks the same topic and lists scope, start time, task, written files and open questions", () => {
  const question = {
    message_id: "msg_q1",
    chat_id: "chat-unit",
    asker_id: parser.agent_id,
    asker_name: parser.name,
    asker_run_id: "run_parser",
    to_id: tokenizer.agent_id,
    to_name: tokenizer.name,
    about: "src/parser/tokens.ts",
    summary: "Who changes TokenKind?",
    at: Date.parse("2026-10-13T13:07:00"),
  };
  const entries = [
    entry(tokenizer, run_of("running", "2026-10-13T13:00:00"), { written: ["src/parser/tokens.ts"] }),
    { ...entry(parser, run_of("running", "2026-10-13T13:05:00")), questions: [question] },
    entry(docs, run_of("completed", "2026-10-13T12:30:00", "2026-10-13T12:40:00")),
  ];
  const text = roster_text(entries, tokenizer.agent_id, now);
  const lines = text.split("\n");
  assert.equal(lines[0], "Agents in this chat at 13:17. The main agent leads the work; reach it with message_main_agent.");
  assert.equal(lines[1], "- Tokenizer#3f2a91c0 (you), topic parser, scope src/parser/tokens.ts, worker, model m, running since 13:00 (17 min). Task: Tokenizer does its part. Wrote: src/parser/tokens.ts.");
  assert.equal(
    lines[2],
    "- Parser#1a2b3c4d, topic Parser (same topic as you), scope src/parser, worker, model m, running since 13:05 (12 min). Task: Parser does its part. Open questions: to Tokenizer#3f2a91c0 about src/parser/tokens.ts since 13:07 (msg_q1).",
  );
  assert.equal(lines[3], "- Docs#9d8c7b6a, topic docs, completed at 12:40 (37 min ago)");
  assert.match(roster_text(entries, null, now), /^Agents in this chat at 13:17\. You are the main agent; these are your sub-agents\.\n- Tokenizer#3f2a91c0, topic parser, scope/);
  assert.match(roster_text(entries, null, now), /- Parser#1a2b3c4d, topic Parser, scope src\/parser/);
});

test("an agent without a topic is its own topic and never matches another empty topic", () => {
  const loner = record("agent_aaaaaaaa-4444-4000-8000-000000000004", "Loner", "");
  const other = record("agent_bbbbbbbb-5555-4000-8000-000000000005", "Other", "");
  const text = roster_text([entry(loner, run_of("running", "2026-10-13T13:00:00")), entry(other, run_of("running", "2026-10-13T13:00:00"))], loner.agent_id, now);
  assert.doesNotMatch(text, /same topic/);
  assert.match(text, /topic none/);
});

test("the roster delta is a full snapshot first, then reports only joins, restarts and ends", () => {
  const live = create_live(tokenizer.agent_id, "run_delta", "chat-unit");
  try {
    const own = entry(tokenizer, run_of("running", "2026-10-13T13:00:00"));
    const snapshot = roster_delta(live, [own], now);
    assert.match(snapshot ?? "", /^Agents in this chat at 13:17\./);
    assert.match(snapshot ?? "", /Tokenizer#3f2a91c0 \(you\)/);
    assert.equal(roster_delta(live, [own], now), null);
    const joined = entry(parser, run_of("running", "2026-10-13T13:05:00"));
    const delta = roster_delta(live, [own, joined], now) ?? "";
    assert.match(delta, /^Agents of this chat that started or ended since your last round \(13:17\):\n- New: Parser#1a2b3c4d, topic Parser \(same topic as you\)/);
    assert.equal(roster_delta(live, [own, joined], now), null);
    const ended = entry(parser, run_of("completed", "2026-10-13T13:05:00", "2026-10-13T13:15:00"));
    const gone = roster_delta(live, [own, ended], now) ?? "";
    assert.match(gone, /- Ended: Parser#1a2b3c4d, topic Parser, completed at 13:15\. get_agent_status with agent_id agent_1a2b3c4d-2222-4000-8000-000000000002 gives its report\./);
    const again = entry(parser, { ...run_of("running", "2026-10-13T13:05:00"), run_id: "run_again" });
    assert.match(roster_delta(live, [own, again], now) ?? "", /- Running again: Parser#1a2b3c4d/);
  } finally {
    forget_live("run_delta");
  }
});

test("an overlap is announced once per pair and path, and shared reads introduce nobody", () => {
  const live = create_live(tokenizer.agent_id, "run_overlap", "chat-unit");
  try {
    const reader = record("agent_cccccccc-6666-4000-8000-000000000006", "Reader", "docs");
    const own = entry(tokenizer, run_of("running", "2026-10-13T13:00:00"), { written: ["src/parser/tokens.ts"], read: ["package.json"] });
    const peer = entry(reader, run_of("running", "2026-10-13T13:01:00"), { read: ["src/parser/tokens.ts", "package.json"] });
    const first = overlaps(live, [own, peer]);
    assert.deepEqual(first, [
      "Overlap with Reader#cccccccc (topic docs): you wrote src/parser/tokens.ts, which Reader#cccccccc read. Agree with Reader#cccccccc on who changes what, with message_peer.",
    ]);
    assert.deepEqual(overlaps(live, [own, peer]), []);
    const scoped = entry(parser, run_of("running", "2026-10-13T13:02:00"), { written: ["SRC\\parser\\lexer.ts"] });
    const second = overlaps(live, [own, peer, scoped]);
    assert.equal(second.length, 1);
    assert.equal(second[0], "Overlap with Parser#1a2b3c4d (topic Parser, same topic as you): both of you have src/parser/tokens.ts in your scope. Agree with Parser#1a2b3c4d on who changes what, with message_peer.");
    const writer = { ...scoped, written: ["SRC\\parser\\lexer.ts", "Package.json"] };
    assert.deepEqual(overlaps(live, [own, peer, writer]), [
      "Overlap with Parser#1a2b3c4d (topic Parser, same topic as you): Parser#1a2b3c4d wrote Package.json, which you read. Agree with Parser#1a2b3c4d on who changes what, with message_peer.",
    ]);
    assert.deepEqual(overlaps(live, [own, peer, writer]), []);
    const more = { ...peer, written: ["docs/readme.md"] };
    assert.deepEqual(overlaps(live, [own, more]), []);
    const shared_read = entry(docs, run_of("running", "2026-10-13T13:03:00"), { read: ["package.json"] });
    assert.deepEqual(overlaps(live, [own, shared_read]), []);
  } finally {
    forget_live("run_overlap");
  }
});

test("a sub-agent gets the roster at round 0 and a delta when a peer joins and when it ends", async () => {
  tools.push(probe);
  const seen: string[] = [];
  let b_run = "";
  let a_round = 0;
  scripts.set("roster joiner B", async () => completed({ content: "B report" }));
  scripts.set("roster watcher A", async (messages) => {
    a_round += 1;
    seen.push(last_user(messages));
    if (a_round === 1) {
      const b = deploy_agent(request("roster joiner B", { chat_id: "chat-roster", name: "Joiner", topic: "parser" }));
      b_run = b.run.run_id;
      await wait_for(() => reports.some((report) => report.run_id === b_run));
      return completed({ tool_calls: [probe_call("p1")], finish_reason: "tool_calls" });
    }
    return completed({ content: "A done" });
  });
  const a = deploy_agent(request("roster watcher A", { chat_id: "chat-roster", name: "Watcher", topic: "parser" }));
  await wait_for(() => reports.some((report) => report.run_id === a.run.run_id));
  assert.match(seen[0] ?? "", /Agents in this chat at \d\d:\d\d\. The main agent leads the work; reach it with message_main_agent\.\n- Watcher#[0-9a-f]{8} \(you\), topic parser/);
  assert.match(seen[1] ?? "", /- New and already ended: Joiner#[0-9a-f]{8}, topic parser, completed at \d\d:\d\d\. get_agent_status/);
  tools.pop();
});

test("a running peer that joins shows up as new, with the same-topic mark", async () => {
  tools.push(probe);
  const seen: string[] = [];
  let a_round = 0;
  scripts.set("roster parked B", block_until_abort);
  scripts.set("roster watcher C", async (messages) => {
    a_round += 1;
    seen.push(last_user(messages));
    if (a_round === 1) {
      deploy_agent(request("roster parked B", { chat_id: "chat-roster-2", name: "Parked", topic: "Parser" }));
      return completed({ tool_calls: [probe_call("p1")], finish_reason: "tool_calls" });
    }
    return completed({ content: "C done" });
  });
  const c = deploy_agent(request("roster watcher C", { chat_id: "chat-roster-2", name: "Watcher", topic: "parser" }));
  await wait_for(() => reports.some((report) => report.run_id === c.run.run_id));
  assert.match(seen[1] ?? "", /- New: Parked#[0-9a-f]{8}, topic Parser \(same topic as you\), no scope, worker, model test\/model, running since/);
  const parked = roster_entries("chat-roster-2").find((item) => item.agent.name === "Parked");
  assert.ok(parked?.running);
  const agent = get_agent(parked.agent.agent_id);
  assert.ok(agent);
  cancel_agent(agent);
  await wait_for(() => live_run(parked.run?.run_id ?? "") === null);
  tools.pop();
});

test("find_agent resolves Name#xxxxxxxx, xxxxxxxx, the full id and a unique prefix", async () => {
  scripts.set("roster find", block_until_abort);
  const started = deploy_agent(request("roster find", { chat_id: "chat-find", name: "Finder" }));
  const id = started.agent.agent_id;
  const short = id.replace(/^agent_/, "").replace(/-/g, "").slice(0, 8);
  assert.equal(find_agent(`Finder#${short}`, "chat-find").agent?.agent_id, id);
  assert.equal(find_agent(short, "chat-find").agent?.agent_id, id);
  assert.equal(find_agent(id, "chat-find").agent?.agent_id, id);
  assert.equal(find_agent(id.slice(0, 12), "chat-find").agent?.agent_id, id);
  assert.equal(find_agent(`Finder#${short}`, "another-chat").agent, null);
  assert.equal(find_agent("Finder#", "chat-find").agent, null);
  const agent = get_agent(id);
  assert.ok(agent);
  cancel_agent(agent);
});

test("closing questions to an agent removes them from the asker's roster line", () => {
  const question = {
    message_id: "msg_q2",
    chat_id: "chat-unit",
    asker_id: parser.agent_id,
    asker_name: parser.name,
    asker_run_id: "run_close",
    to_id: docs.agent_id,
    to_name: docs.name,
    about: "docs/parser.md",
    summary: "Where do the notes go?",
    at: now,
  };
  ask_question(question);
  assert.deepEqual(close_questions_to(docs.agent_id).map((entry) => entry.message_id), ["msg_q2"]);
  assert.deepEqual(close_questions_to(docs.agent_id), []);
});
