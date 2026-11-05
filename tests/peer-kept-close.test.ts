import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { live_run, live_runs } from "../electron/agents/live.ts";
import { send_peer } from "../electron/agents/peers.ts";
import { questions_asked_by } from "../electron/agents/questions.ts";
import { drop_agent_notes, take_agent_notes } from "../electron/agents/reports.ts";
import { continue_agent, deploy_agent, message_agent, shutdown_agents_sync } from "../electron/agents/runner.ts";
import { get_agent, init_agent_store } from "../electron/agents/store.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import { list_agents_tool } from "../electron/tools/agents/list.ts";
import { get_agent_status_tool } from "../electron/tools/agents/manage.ts";
import { continue_agent_tool } from "../electron/tools/agents/start.ts";
import { block_until_abort, completed, events, reports, request, root, scripts, start_runner, stop_runner, tools, wait_for } from "./agents-runner-harness.ts";
import { allowed_peer_tool, calls, is_peer_note, label, parked, peer_request, peer_views, reported, run_context, sender_of, stepper, stop_all, tool_context } from "./peer-flow-kit.ts";

before(start_runner);

after(stop_runner);

tools.push(allowed_peer_tool, list_agents_tool);

scripts.set("kc park", block_until_abort);

test("an answer to the old question of a continued agent lowers the open question count of its running run", async () => {
  const asked = deploy_agent(request("kc park", { chat_id: "kc-count", name: "Asked" }));
  await parked(asked);
  scripts.set(
    "kc ask once",
    stepper([
      async () => calls(["message_peer", { to: label(asked), type: "question", about: "src/parser/tokens.ts", summary: "who changes TokenKind", text: "Who changes TokenKind?" }]),
      async () => completed({ content: "asked, ending" }),
      block_until_abort,
    ]),
  );
  const asker = deploy_agent(request("kc ask once", { chat_id: "kc-count", name: "Asker" }));
  await reported(asker.run.run_id);
  const agent = get_agent(asker.agent.agent_id);
  assert.ok(agent);
  const next = await continue_agent(agent, run_context("kc-count", "kc continue"));
  try {
    assert.equal(next.run.open_questions, 1);
    await wait_for(() => events.some((event) => event.run_id === next.run.run_id && event.type === "context"));
    const [question] = questions_asked_by(asker.agent.agent_id);
    assert.ok(question);
    await send_peer(sender_of(asked), peer_request(label(asker), "answer", "Tokenizer changes it.", question.message_id));
    assert.equal(questions_asked_by(asker.agent.agent_id).length, 0);
    assert.deepEqual(
      get_agent(asker.agent.agent_id)?.runs.map((run) => run.open_questions),
      [1, 0],
    );
  } finally {
    await stop_all(asked, next);
  }
});

test("a message that arrives after a round that only ended a tool step keeps no status sentence as an earlier report", async () => {
  const peer = deploy_agent(request("kc park", { chat_id: "kc-status", name: "Peer" }));
  await parked(peer);
  const ids = { worker: "" };
  scripts.set(
    "kc worker",
    stepper([
      async () => ({ ...calls(["list_agents", {}]), content: "Reading the roster." }),
      async () => {
        await send_peer(sender_of(peer), peer_request(ids.worker, "info", "lexer.ts moved to src/parser/lex/"));
        return completed({ content: "" });
      },
      async () => completed({ content: "FINAL: the roster has two agents." }),
    ]),
  );
  const worker = deploy_agent(request("kc worker", { chat_id: "kc-status", name: "Worker" }));
  ids.worker = label(worker);
  try {
    await reported(worker.run.run_id);
    const report = reports.find((entry) => entry.run_id === worker.run.run_id);
    assert.equal(await fs.readFile(report?.report_path ?? "", "utf8"), "FINAL: the roster has two agents.");
  } finally {
    await stop_all(peer);
  }
});

test("closing the app while an agent handles a late message keeps the report it had already written", async () => {
  await wait_for(() => live_runs().length === 0);
  const peer = deploy_agent(request("kc park", { chat_id: "kc-late-close", name: "Peer" }));
  await parked(peer);
  const ids = { writer: "" };
  let late_round = false;
  scripts.set(
    "kc late writer",
    stepper([
      async () => {
        await send_peer(sender_of(peer), peer_request(ids.writer, "info", "lexer.ts moved to src/parser/lex/"));
        return completed({ content: "FULL REPORT: three token kinds in src/parser/tokens.ts:12." });
      },
      async () => ({ ...calls(["list_agents", {}]), content: "Noted, checking the roster." }),
      async (messages, signal) => {
        late_round = true;
        return block_until_abort(messages, signal);
      },
    ]),
  );
  const writer = deploy_agent(request("kc late writer", { chat_id: "kc-late-close", name: "Writer" }));
  ids.writer = label(writer);
  await wait_for(() => late_round);
  shutdown_agents_sync();
  await wait_for(() => live_runs().length === 0);
  const run = get_agent(writer.agent.agent_id)?.runs.at(-1);
  assert.equal(run?.status, "interrupted");
  assert.match(run?.report ?? "", /^FULL REPORT: three token kinds[\s\S]*Noted, checking the roster\.$/);
});

test("an instruction and an answer unread when the app closed are kept, shown to the main agent and delivered before the next task", async () => {
  await wait_for(() => live_runs().length === 0);
  let second_run: ApiMessage[] = [];
  scripts.set(
    "kc reader",
    stepper([
      block_until_abort,
      async (messages) => {
        second_run = messages;
        return completed({ content: "used both" });
      },
    ]),
  );
  const a = deploy_agent(request("kc reader", { chat_id: "kc-close", name: "Reader" }));
  await parked(a);
  const reader = get_agent(a.agent.agent_id);
  assert.ok(reader && message_agent(reader, "Also check src/parser/lexer.ts."));
  scripts.set(
    "kc answerer",
    stepper([
      async () => calls(["message_peer", { to: label(a), type: "answer", about: "src/parser/tokens.ts", summary: "three token kinds", text: "TokenKind has three values.", in_reply_to: "msg_00000000cccc" }]),
      block_until_abort,
    ]),
  );
  const b = deploy_agent(request("kc answerer", { chat_id: "kc-close", name: "Answerer" }));
  await wait_for(() => peer_views(b.run.run_id).length === 1 && (live_run(a.run.run_id)?.inbox.length ?? 0) === 2);
  const answer = peer_views(b.run.run_id)[0]?.view.message_id ?? "";
  assert.equal(peer_views(b.run.run_id)[0]?.view.outcome, "queued");
  shutdown_agents_sync();
  await wait_for(() => live_runs().length === 0);
  assert.ok(!take_agent_notes("kc-close").some((note) => note.text.includes("ended before it read your message_agent instruction")));
  drop_agent_notes("kc-close");
  await init_agent_store(path.join(root, "agents"));
  assert.deepEqual(
    get_agent(a.agent.agent_id)?.held.map((entry) => entry.from),
    ["main", "peer"],
  );
  const main = tool_context("kc-close", "main");
  const listed = await list_agents_tool.execute(main, {});
  assert.match(listed.text, new RegExp(`Reader#[0-9a-f]{8}, topic none, interrupted at \\d\\d:\\d\\d \\(\\d+ min ago\\), kept for its next run: an instruction from the main agent that it had not read when the app closed; answer ${answer} from Answerer#[0-9a-f]{8} about src/parser/tokens\\.ts \\(continue_agent delivers them\\)`));
  const status_a = await get_agent_status_tool.execute(main, { agent_id: label(a) });
  assert.match(status_a.text, /Messages kept for its next run, continue_agent delivers them \(2\):\n- instruction from the main agent, unread when the app closed:\nAlso check src\/parser\/lexer\.ts\.\n- \[msg_[0-9a-f]{12}\] from Answerer#/);
  const status_b = await get_agent_status_tool.execute(main, { agent_id: label(b) });
  assert.match(status_b.text, new RegExp(`\\[${answer}\\] to Reader#[0-9a-f]{8}, answer, about src/parser/tokens\\.ts, kept for the recipient's next run, it ended before reading it`));
  const result = await continue_agent_tool.execute(main, { agent_id: label(a), prompt: "kc next task" });
  assert.equal(result.status, "done", result.text);
  assert.match(result.text, / 1 kept peer message\(s\) arrive at the start of this run\. 1 instruction\(s\) of yours that it had not read when the app closed arrive before this task\./);
  await reported(result.view?.kind === "agent" ? result.view.run_id : "");
  const instruction_at = second_run.findIndex((message) => message.role === "user" && String(message.content).endsWith("Also check src/parser/lexer.ts."));
  const answer_at = second_run.findIndex(is_peer_note);
  const task_at = second_run.findIndex((message) => message.role === "user" && message.content === "kc next task");
  assert.ok(instruction_at >= 0 && instruction_at < answer_at && answer_at < task_at, `instruction ${instruction_at}, answer ${answer_at}, task ${task_at}`);
  assert.match(String(second_run[instruction_at]?.content), /during your previous run, which ended before you read it/);
  assert.deepEqual(get_agent(a.agent.agent_id)?.held, []);
});
