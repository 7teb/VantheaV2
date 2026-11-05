import assert from "node:assert/strict";
import fs from "node:fs/promises";
import sync_fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test, type TestContext } from "node:test";
import { report_notice_context } from "../shared/agent-notes.ts";
import type { StreamEventBody } from "../shared/events.ts";
import type { ModelEntry } from "../shared/models.ts";
import type { Settings } from "../shared/settings.ts";
import {
  deliver_report,
  deliver_update,
  flush_reports,
  has_agent_notes,
  major_wait_ms,
  queue_digest,
  set_agent_continuation,
  take_agent_notes,
  wait_for_input,
  wake_idle,
  type AgentReport,
  type AgentUpdate,
} from "../electron/agents/reports.ts";
import { begin_run, create_agent, end_run, init_agent_store } from "../electron/agents/store.ts";
import type { ApiMessage, RoundResult } from "../electron/model/types.ts";
import { active_turn, push_steer, register_active, release_chat, reserve_chat, take_steer_active, unregister_active } from "../electron/turn/active.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import type { StreamFn, TurnSession } from "../electron/turn/session.ts";
import { review_stub } from "./review-stub.ts";

const model: ModelEntry = {
  id: "m",
  label: "M",
  provider: "p",
  provider_order: [],
  efforts: ["high"],
  default_effort: "high",
  vision: false,
  context_length: 1_000_000,
  max_output: 4096,
  reasoning_passback: false,
};

const continued: AgentReport[] = [];

let root = "";

const report_path = (chat_id: string, text: string) => path.join(root, `run_${text.length}_${chat_id}.report.md`);

const report = (chat_id: string, text: string): AgentReport => {
  const file = report_path(chat_id, text);
  sync_fs.writeFileSync(file, text, "utf8");
  return {
    chat_id,
    agent_id: "agent_x",
    run_id: `run_${text.length}_${chat_id}`,
    name: "Reviewer",
    profile: "explore",
    model: "m",
    status: "completed",
    started_at: "2026-01-01T00:00:00.000Z",
    ended_at: "2026-01-01T00:01:00.000Z",
    report_path: file,
    stop_reason: "stop",
  };
};

const update = (chat_id: string, run_id: string, text: string): AgentUpdate => ({ chat_id, agent_id: "agent_x", run_id, name: "Reviewer", text });

const completed = (content: string): RoundResult => ({
  status: "completed",
  content,
  reasoning: "",
  reasoning_details: [],
  tool_calls: [],
  finish_reason: "stop",
  usage: null,
});

const activate = (chat_id: string) => register_active(chat_id, `msg-${chat_id}`, () => undefined, model, "major");

type Harness = { session: TurnSession; events: StreamEventBody[]; controller: AbortController; messages: ApiMessage[] };

const harness = (chat_id: string, stream: StreamFn, wait_ms: number): Harness => {
  const controller = new AbortController();
  const events: StreamEventBody[] = [];
  const session: TurnSession = {
    compaction: { audience: "user", facts: async () => "" },
    chat_id,
    message_id: `msg-${chat_id}`,
    user_request: "go",
    project_root: "C:/p",
    settings: {} as Settings,
    model,
    effort: "major",
    mode: "auto",
    plan: false,
    signal: controller.signal,
    emit: (body) => events.push(body),
    stream,
    resolve_tools: () => [],
    side_model: async () => "",
    review: review_stub(),
    wait_decision: async () => ({ approved: true, grant: "once", feedback: "" }),
    steers: {
      next: () => active_turn(chat_id)?.steers[0] ?? null,
      noted: async (steer) => steer.attachments,
      take: (steer_id) => {
        take_steer_active(chat_id, steer_id);
      },
    },
    take_notes: () => take_agent_notes(chat_id),
    idle: () => wait_for_input(chat_id, wait_ms, controller.signal),
  };
  return { session, events, controller, messages: [{ role: "system", content: "s" }] };
};

const settle = async () => {
  for (let index = 0; index < 30; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const running_agent = (chat_id: string) => {
  const agent = create_agent({ chat_id, name: "Reviewer", description: "", topic: "", scope: [], model: "m", effort: "", profile: "explore", without_tools: [], project_root: "C:/p" });
  const run = begin_run(agent, "review", "parent");
  return { agent, run };
};

const end_of = (events: StreamEventBody[]) => events.filter((event) => event.type === "end");

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-agent-reports-"));
  await init_agent_store(path.join(root, "agents"));
  set_agent_continuation((notice) => {
    if (notice.kind === "report") {
      continued.push(notice.report);
    }
  });
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("a report for a chat with an active turn waits for that turn's next round", () => {
  activate("chat-active");
  deliver_report(report("chat-active", "found two races"));
  assert.equal(continued.length, 0);
  assert.equal(has_agent_notes("chat-active"), true);
  const notes = take_agent_notes("chat-active");
  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.kind, "notice");
  assert.ok(notes[0]?.content.includes(report_path("chat-active", "found two races")));
  assert.ok(notes[0]?.text.includes(report_path("chat-active", "found two races")));
  assert.doesNotMatch(notes[0]?.content ?? "", /found two races/);
  assert.equal(has_agent_notes("chat-active"), false);
  unregister_active("chat-active", "msg-chat-active");
});

test("every report notice keeps the read instructions and adds the stop reason and how to continue the agent", () => {
  activate("chat-notice");
  deliver_report({ ...report("chat-notice", "x"), stop_reason: "stop" });
  const notes = take_agent_notes("chat-notice");
  const content = notes[0]?.content ?? "";
  assert.match(content, /YOU MUST READ THE COMPLETE REPORT/);
  assert.ok(content.includes(report_path("chat-notice", "x")));
  assert.match(content, /Model stop reason: stop/);
  assert.match(content, /If the report is missing or unfinished, continue the agent with continue_agent and agent_id "agent_x"/);
  assert.ok(content.includes("Full run log with all reasoning, text, tool calls and tool results, one JSON event per line: " + report_path("chat-notice", "x").replace(/\.report\.md$/, ".jsonl")));
  assert.equal(report_notice_context(notes[0]?.text ?? ""), notes[0]?.text);
  unregister_active("chat-notice", "msg-chat-notice");
});

test("a chat whose turn is still starting counts as active for reports, steers and new turns", () => {
  assert.equal(reserve_chat("chat-starting"), true);
  assert.equal(reserve_chat("chat-starting"), false);
  assert.equal(push_steer("chat-starting", "too early"), false);
  const before = continued.length;
  deliver_report(report("chat-starting", "early report"));
  assert.equal(continued.length, before);
  assert.equal(has_agent_notes("chat-starting"), true);
  activate("chat-starting");
  release_chat("chat-starting");
  assert.equal(reserve_chat("chat-starting"), false);
  assert.equal(take_agent_notes("chat-starting").length, 1);
  unregister_active("chat-starting", "msg-chat-starting");
  assert.equal(reserve_chat("chat-starting"), true);
  release_chat("chat-starting");
});

test("a report for an idle chat starts a continuation, and leftovers at turn end follow it", async () => {
  deliver_report(report("chat-idle", "all clear"));
  assert.equal(await fs.readFile(continued.at(-1)?.report_path ?? "", "utf8"), "all clear");
  activate("chat-late");
  deliver_report(report("chat-late", "arrived during the last round"));
  const before_flush = continued.length;
  unregister_active("chat-late", "msg-chat-late");
  flush_reports("chat-late");
  assert.equal(continued.length, before_flush + 1);
  assert.equal(await fs.readFile(continued.at(-1)?.report_path ?? "", "utf8"), "arrived during the last round");
});

test("a report that lands during the final round is injected before the turn ends", async () => {
  activate("chat-inject");
  let call = 0;
  const stream: StreamFn = async (request) => {
    call += 1;
    if (call === 1) {
      deliver_report(report("chat-inject", "the seam is broken"));
      return completed("waiting");
    }
    const last = request.messages.at(-1);
    const file = typeof last?.content === "string" ? /^Report file: (.+)$/m.exec(last.content)?.[1] : undefined;
    return completed(file && (await fs.readFile(file, "utf8")) === "the seam is broken" ? "fixed the seam" : "missed");
  };
  const h = harness("chat-inject", stream, 0);
  await run_turn_loop(h.session, h.messages);
  unregister_active("chat-inject", "msg-chat-inject");
  assert.equal(call, 2);
  assert.ok(h.events.some((event) => event.type === "notice" && event.notice === "agent_report"));
  assert.equal(h.messages.at(-1)?.role === "assistant" ? h.messages.at(-1)?.content : "", "fixed the seam");
  assert.equal(end_of(h.events).length, 1);
  assert.equal(end_of(h.events)[0]?.type === "end" && end_of(h.events)[0]?.status, "done");
});

test("major accepts an empty response, waits for the next agent report and then continues", async (t: TestContext) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  activate("chat-major");
  const { agent, run } = running_agent("chat-major");
  let call = 0;
  const stream: StreamFn = async () => {
    call += 1;
    return completed(call === 1 ? "" : "synthesis");
  };
  const h = harness("chat-major", stream, major_wait_ms);
  const done = run_turn_loop(h.session, h.messages);
  await settle();
  t.mock.timers.tick(10 * 60 * 1000);
  await settle();
  assert.equal(call, 1);
  assert.equal(end_of(h.events).length, 0);
  end_run(agent.agent_id, run.run_id, "completed", "no defect found");
  deliver_report(report("chat-major", "no defect found"));
  await done;
  unregister_active("chat-major", "msg-chat-major");
  assert.equal(call, 2);
  assert.equal(end_of(h.events)[0]?.type === "end" && end_of(h.events)[0]?.status, "done");
  assert.ok(h.messages.some((message) => message.role === "user" && typeof message.content === "string" && message.content.includes(report_path("chat-major", "no defect found"))));
  assert.doesNotMatch(JSON.stringify(h.messages), /no defect found/);
});

test("major gives up after thirty minutes without a report", async (t: TestContext) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  activate("chat-timeout");
  running_agent("chat-timeout");
  let call = 0;
  const stream: StreamFn = async () => {
    call += 1;
    return completed("still waiting");
  };
  const h = harness("chat-timeout", stream, major_wait_ms);
  const done = run_turn_loop(h.session, h.messages);
  await settle();
  t.mock.timers.tick(major_wait_ms - 1);
  await settle();
  assert.equal(end_of(h.events).length, 0);
  t.mock.timers.tick(1);
  await done;
  unregister_active("chat-timeout", "msg-chat-timeout");
  assert.equal(call, 1);
  assert.equal(end_of(h.events)[0]?.type === "end" && end_of(h.events)[0]?.status, "done");
});

test("stopping the turn during the major wait ends it as stopped", async (t: TestContext) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  activate("chat-stop");
  running_agent("chat-stop");
  const h = harness("chat-stop", async () => completed("waiting"), major_wait_ms);
  const done = run_turn_loop(h.session, h.messages);
  await settle();
  h.controller.abort(new Error("the user stopped the turn"));
  await done;
  unregister_active("chat-stop", "msg-chat-stop");
  assert.equal(end_of(h.events).length, 1);
  assert.equal(end_of(h.events)[0]?.type === "end" && end_of(h.events)[0]?.status, "stopped");
});

test("a user steer during the major wait wakes the turn instead of waiting for a report", async (t: TestContext) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  activate("chat-steer");
  const { agent, run } = running_agent("chat-steer");
  let call = 0;
  const stream: StreamFn = async (request) => {
    call += 1;
    if (call === 1) {
      return completed("agents are on it");
    }
    end_run(agent.agent_id, run.run_id, "completed", "");
    const last = request.messages.at(-1);
    return completed(typeof last?.content === "string" && last.content.includes("also check the docs") ? "will check the docs" : "missed");
  };
  const h = harness("chat-steer", stream, major_wait_ms);
  const done = run_turn_loop(h.session, h.messages);
  await settle();
  assert.equal(call, 1);
  assert.equal(push_steer("chat-steer", "also check the docs"), true);
  wake_idle("chat-steer");
  await done;
  unregister_active("chat-steer", "msg-chat-steer");
  assert.equal(call, 2);
  assert.ok(h.events.some((event) => event.type === "steer" && event.text === "also check the docs"));
  assert.equal(h.messages.at(-1)?.role === "assistant" ? h.messages.at(-1)?.content : "", "will check the docs");
  assert.equal(end_of(h.events)[0]?.type === "end" && end_of(h.events)[0]?.status, "done");
});

test("an update during the major wait wakes the turn and is answered", async (t: TestContext) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  activate("chat-wake");
  const { agent, run } = running_agent("chat-wake");
  let call = 0;
  const stream: StreamFn = async (request) => {
    call += 1;
    if (call === 1) {
      return completed("agents are on it");
    }
    end_run(agent.agent_id, run.run_id, "completed", "");
    const last = request.messages.at(-1);
    return completed(typeof last?.content === "string" && last.content.includes("found the leak in pool.cpp") ? "leaving pool.cpp to the agent" : "missed");
  };
  const h = harness("chat-wake", stream, major_wait_ms);
  const done = run_turn_loop(h.session, h.messages);
  await settle();
  assert.equal(call, 1);
  deliver_update(update("chat-wake", run.run_id, "found the leak in pool.cpp"));
  await done;
  unregister_active("chat-wake", "msg-chat-wake");
  assert.equal(call, 2);
  assert.ok(h.events.some((event) => event.type === "notice" && event.notice === "agent_update"));
  assert.equal(h.messages.at(-1)?.role === "assistant" ? h.messages.at(-1)?.content : "", "leaving pool.cpp to the agent");
  assert.equal(end_of(h.events)[0]?.type === "end" && end_of(h.events)[0]?.status, "done");
});

test("a peer digest never keeps a waiting main turn awake and never starts a turn by itself", async () => {
  const chat_id = "chat-digest";
  const { agent, run } = running_agent(chat_id);
  const line = "Parser#1a2b3c4d → Tokenizer#3f2a91c0: question, about src/parser/tokens.ts: 'Who changes TokenKind?'";
  queue_digest(chat_id, line);
  assert.equal(has_agent_notes(chat_id), false);
  assert.equal(await wait_for_input(chat_id, 30, new AbortController().signal), false);
  const before = continued.length;
  flush_reports(chat_id);
  assert.equal(continued.length, before);
  const notes = take_agent_notes(chat_id);
  assert.deepEqual(
    notes.map((note) => (note.kind === "notice" ? [note.notice, note.text] : [note.kind, note.text])),
    [["peer_digest", line]],
  );
  assert.match(notes[0]?.content ?? "", /^\[Internal app event, not a user message and not a task\. A short line about messages between your sub-agents; get_agent_status shows the full texts\./);
  assert.deepEqual(take_agent_notes(chat_id), []);
  end_run(agent.agent_id, run.run_id, "completed", "");
});
