import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { live_run } from "../electron/agents/live.ts";
import { send_peer } from "../electron/agents/peers.ts";
import { roster_facts } from "../electron/agents/roster.ts";
import { agent_session } from "../electron/agents/session.ts";
import { continue_agent, deploy_agent, type StartedRun } from "../electron/agents/runner.ts";
import { get_agent } from "../electron/agents/store.ts";
import { list_agents_tool } from "../electron/tools/agents/list.ts";
import { get_agent_status_tool } from "../electron/tools/agents/manage.ts";
import type { Tool } from "../electron/tools/types.ts";
import { block_until_abort, completed, events, model, request, reviewer, scripts, start_runner, stop_runner, stream, tools, wait_for } from "./agents-runner-harness.ts";
import { allowed_peer_tool, calls, deferred, label, parked, reported, run_context, sender_of, stepper, stop_chat, tool_context, view_of } from "./peer-flow-kit.ts";

before(start_runner);

after(stop_runner);

const view_tool = (name: string, kind: "edit" | "read"): Tool => ({
  spec: { name, description: "", parameters: { type: "object", properties: {} } },
  profiles: ["worker", "explore"],
  available: () => true,
  execute: async (_ctx, raw) => {
    const file = String(raw.path);
    if (kind === "edit") {
      return { status: "done", text: `wrote ${file}`, view: { kind: "edit", path: file, created: false, added: 1, removed: 0, diff: [] } };
    }
    return { status: "done", text: `read ${file}`, view: { kind: "read", path: file, start_line: 1, end_line: 1, total_lines: 1, truncated: false } };
  },
});

const probe: Tool = {
  spec: { name: "pf_probe", description: "", parameters: { type: "object", properties: {} } },
  profiles: ["worker", "explore"],
  available: () => true,
  execute: async () => ({ status: "done", text: "probed", view: null }),
};

tools.push(probe, view_tool("pf_write", "edit"), view_tool("pf_read", "read"), allowed_peer_tool, list_agents_tool, get_agent_status_tool);

const probe_round = () => calls(["pf_probe", {}]);

const roster_notices = (run_id: string) =>
  events.flatMap((event) => (event.run_id === run_id && event.type === "notice" && event.notice === "agent_roster" ? [{ round: event.round, text: event.text }] : []));

const done_steps = (run_id: string, view_kind: string, file: string) =>
  (live_run(run_id)?.transcript.steps ?? []).some((step) => step.kind === "tool" && step.status === "done" && step.view?.kind === view_kind && "path" in step.view && step.view.path === file);

test("round 0 brings a full roster, later rounds report only a join and an end of another agent", async () => {
  const release_b = deferred();
  let b: StartedRun | null = null;
  scripts.set(
    "pf join A",
    stepper([
      async () => {
        b = deploy_agent(request("pf join B", { chat_id: "pf-join", name: "Two", topic: "Parser" }));
        return probe_round();
      },
      async () => {
        release_b.resolve();
        await reported(b?.run.run_id ?? "");
        return probe_round();
      },
      async () => probe_round(),
    ]),
  );
  scripts.set("pf join B", async () => {
    await release_b.promise;
    return completed({ content: "B report" });
  });
  const a = deploy_agent(request("pf join A", { chat_id: "pf-join", name: "One", topic: "parser" }));
  await reported(a.run.run_id);
  const started_b = b as StartedRun | null;
  assert.ok(started_b);
  const own = roster_notices(a.run.run_id);
  assert.deepEqual(
    own.map((notice) => notice.round),
    [0, 1, 2],
  );
  const snapshot = own[0]?.text.split("\n") ?? [];
  assert.match(snapshot[0] ?? "", /^Agents in this chat at \d\d:\d\d\. The main agent leads the work; reach it with message_main_agent\.$/);
  assert.equal(snapshot.length, 2);
  assert.match(snapshot[1] ?? "", new RegExp(`^- ${label(a)} \\(you\\), topic parser, no scope, worker, model test/model, running since \\d\\d:\\d\\d \\(0 min\\)\\. Task: reviews things\\.$`));
  assert.match(own[1]?.text ?? "", new RegExp(`^Agents of this chat that started or ended since your last round \\(\\d\\d:\\d\\d\\):\\n- New: ${label(started_b)}, topic Parser \\(same topic as you\\), no scope`));
  assert.equal(own[1]?.text.split("\n").length, 2);
  assert.match(
    own[2]?.text ?? "",
    new RegExp(`\\n- Ended: ${label(started_b)}, topic Parser, completed at \\d\\d:\\d\\d\\. get_agent_status with agent_id ${started_b.agent.agent_id} gives its report\\.$`),
  );
  const theirs = roster_notices(started_b.run.run_id);
  assert.equal(theirs.length, 1);
  assert.equal(theirs[0]?.round, 0);
  assert.match(theirs[0]?.text ?? "", new RegExp(`- ${label(a)}, topic parser \\(same topic as you\\), no scope`));
  assert.match(theirs[0]?.text ?? "", new RegExp(`- ${label(started_b)} \\(you\\), topic Parser,`));
});

test("an agent that starts and ends between two rounds shows as new and ended, and a continued agent gets a full snapshot again", async () => {
  let quick: StartedRun | null = null;
  const continued = { run_id: "" };
  scripts.set("pf quick", async () => completed({ content: "quick report" }));
  scripts.set(
    "pf watcher",
    stepper([
      async () => {
        quick = deploy_agent(request("pf quick", { chat_id: "pf-between", name: "Quick", topic: "docs" }));
        await reported(quick.run.run_id);
        return probe_round();
      },
      async () => {
        const agent = get_agent(quick?.agent.agent_id ?? "");
        assert.ok(agent);
        const next = await continue_agent(agent, run_context("pf-between", "pf quick again"));
        continued.run_id = next.run.run_id;
        await reported(next.run.run_id);
        return probe_round();
      },
    ]),
  );
  const watcher = deploy_agent(request("pf watcher", { chat_id: "pf-between", name: "Watcher", topic: "api" }));
  await reported(watcher.run.run_id);
  const started_quick = quick as StartedRun | null;
  assert.ok(started_quick);
  const seen = roster_notices(watcher.run.run_id);
  assert.match(seen[1]?.text ?? "", new RegExp(`\\n- New and already ended: ${label(started_quick)}, topic docs, completed at \\d\\d:\\d\\d\\. get_agent_status with agent_id ${started_quick.agent.agent_id} gives its report\\.$`));
  assert.match(seen[2]?.text ?? "", new RegExp(`- Ended: ${label(started_quick)}, topic docs, completed`));
  const restart = roster_notices(continued.run_id);
  assert.equal(restart[0]?.round, 0);
  assert.match(restart[0]?.text ?? "", /^Agents in this chat at \d\d:\d\d\./);
  assert.match(restart[0]?.text ?? "", new RegExp(`- ${label(watcher)}, topic api, no scope`));
});

test("an overlap from real edit and read steps is announced to both agents once per pair and path", async () => {
  const ids = { w: "", r: "" };
  const stage = { second_write: deferred(), w_done: deferred() };
  scripts.set(
    "pf overlap W",
    stepper([
      async () => {
        await wait_for(() => ids.r !== "" && done_steps(ids.r, "read", "src/a.ts"));
        return calls(["pf_write", { path: "src/a.ts" }], ["pf_read", { path: "package.json" }]);
      },
      async () => calls(["pf_write", { path: "src/a.ts" }]),
      async () => {
        await stage.second_write.promise;
        return calls(["pf_write", { path: "src/b.ts" }]);
      },
      async () => {
        await wait_for(() => done_steps(ids.r, "read", "SRC\\b.ts"));
        return probe_round();
      },
      async () => probe_round(),
      async () => {
        stage.w_done.resolve();
        return completed({ content: "W report" });
      },
    ]),
  );
  scripts.set(
    "pf overlap R",
    stepper([
      async () => calls(["pf_read", { path: "src/a.ts" }], ["pf_read", { path: "package.json" }]),
      async () => {
        await wait_for(() => done_steps(ids.w, "edit", "src/a.ts"));
        return probe_round();
      },
      async () => probe_round(),
      async () => {
        stage.second_write.resolve();
        await wait_for(() => done_steps(ids.w, "edit", "src/b.ts"));
        return calls(["pf_read", { path: "SRC\\b.ts" }]);
      },
      async () => probe_round(),
      async () => {
        await stage.w_done.promise;
        return completed({ content: "R report" });
      },
    ]),
  );
  const r = deploy_agent(request("pf overlap R", { chat_id: "pf-overlap", name: "Reader", topic: "docs" }));
  ids.r = r.run.run_id;
  const w = deploy_agent(request("pf overlap W", { chat_id: "pf-overlap", name: "Writer", topic: "api" }));
  ids.w = w.run.run_id;
  await reported(w.run.run_id);
  await reported(r.run.run_id);
  const overlap_texts = (run_id: string) => roster_notices(run_id).flatMap((notice) => (notice.text.startsWith("Overlap with") ? [notice.text] : []));
  const writer_side = overlap_texts(w.run.run_id);
  const reader_side = overlap_texts(r.run.run_id);
  assert.deepEqual(writer_side, [
    `Overlap with ${label(r)} (topic docs): you wrote src/a.ts, which ${label(r)} read. Agree with ${label(r)} on who changes what, with message_peer.`,
    `Overlap with ${label(r)} (topic docs): you wrote src/b.ts, which ${label(r)} read. Agree with ${label(r)} on who changes what, with message_peer.`,
  ]);
  assert.deepEqual(reader_side, [
    `Overlap with ${label(w)} (topic api): ${label(w)} wrote src/a.ts, which you read. Agree with ${label(w)} on who changes what, with message_peer.`,
    `Overlap with ${label(w)} (topic api): ${label(w)} wrote src/b.ts, which you read. Agree with ${label(w)} on who changes what, with message_peer.`,
  ]);
  assert.ok(!writer_side.join("\n").includes("package.json"));
});

test("compaction facts carry the roster and open questions in both directions", async () => {
  const chat_id = "pf-facts";
  scripts.set("pf facts park", block_until_abort);
  const a = deploy_agent(request("pf facts park", { chat_id, name: "Asker", topic: "parser" }));
  const b = deploy_agent(request("pf facts park", { chat_id, name: "Owner", topic: "parser" }));
  await parked(a, b);
  try {
    const asked = await send_peer(sender_of(a), { to: label(b), type: "question", about: "src/parser/tokens.ts", summary: "who changes TokenKind", text: "Who changes TokenKind?", in_reply_to: null });
    const back = await send_peer(sender_of(b), { to: label(a), type: "question", about: "src/parser/ast.ts", summary: "who owns the AST", text: "Who owns ast.ts?", in_reply_to: null });
    const own = roster_facts(chat_id, a.agent.agent_id);
    assert.ok(own.includes(`- ${label(a)} (you), topic parser,`));
    assert.match(own, new RegExp(`Open questions: to ${label(b)} about src/parser/tokens\\.ts since \\d\\d:\\d\\d \\(${view_of(asked).message_id}\\)\\.\\n- ${label(b)}, topic parser \\(same topic as you\\)`));
    assert.ok(own.endsWith(`\nQuestions to you that are still open, answer each with message_peer type answer and its in_reply_to id: from ${label(b)} about src/parser/ast.ts (${view_of(back).message_id}).`));
    const main = roster_facts(chat_id, null);
    assert.match(main, /^Agents in this chat at \d\d:\d\d\. You are the main agent; these are your sub-agents\./);
    assert.ok(main.includes(`Open questions: to ${label(a)} about src/parser/ast.ts`));
    assert.doesNotMatch(main, /Questions to you/);
    const { agent, run, live } = sender_of(a);
    const deps = { dir: "", stream, resolve_tools: () => [], side_model: async () => "", review_call: reviewer.call, models: async () => [model] };
    const facts = await agent_session(deps, agent, run, live, run_context(chat_id, "pf facts park"), model, { calibration: null, floor: 0 }).compaction.facts();
    const incoming = own.slice(own.indexOf("\nQuestions to you"));
    assert.ok(facts.includes(`- ${label(a)} (you), topic parser,`) && facts.endsWith(incoming), facts);
  } finally {
    await stop_chat(chat_id);
  }
});

test("list_agents marks the caller, and get_agent_status shows a peer's sent and received messages in full with its open question", async () => {
  const chat_id = "pf-detail-flow";
  const ids = { b: "", b_run: "" };
  const results: string[] = [];
  const tool_text = (messages: { role: string; content?: unknown }[]) => String(messages.findLast((message) => message.role === "tool")?.content ?? "");
  scripts.set(
    "pf detail B",
    stepper([
      async (messages) => {
        if (!messages.some((message) => message.role === "user" && String(message.content).includes("Who owns src/lexer.ts"))) {
          await wait_for(() => (live_run(ids.b_run)?.inbox.length ?? 0) > 0);
        }
        return completed({ content: "" });
      },
      block_until_abort,
    ]),
  );
  scripts.set(
    "pf detail A",
    stepper([
      async () => calls(["message_peer", { to: ids.b, type: "question", about: "src/lexer.ts", summary: "who owns the lexer", text: "Who owns src/lexer.ts? See line 40." }]),
      async () => calls(["list_agents", {}]),
      async (messages) => {
        results.push(tool_text(messages));
        await wait_for(() => (live_run(ids.b_run)?.transcript.steps ?? []).some((step) => step.kind === "notice" && step.notice === "peer_message"));
        return calls(["get_agent_status", { agent_id: ids.b }]);
      },
      async (messages) => {
        results.push(tool_text(messages));
        return completed({ content: "A done" });
      },
    ]),
  );
  const b = deploy_agent(request("pf detail B", { chat_id, name: "Lexer", topic: "lexing", scope: ["src/lexer.ts"] }));
  ids.b = label(b);
  ids.b_run = b.run.run_id;
  await parked(b);
  const a = deploy_agent(request("pf detail A", { chat_id, name: "Parser", topic: "parsing" }));
  try {
    await reported(a.run.run_id);
    const [listed, detail] = results;
    assert.ok((listed ?? "").includes(`- ${label(a)} (you), topic parsing,`), listed);
    assert.match(listed ?? "", new RegExp(`Open questions: to ${label(b)} about src/lexer\\.ts since \\d\\d:\\d\\d \\(msg_[0-9a-f]{12}\\)\\.$`));
    assert.ok((listed ?? "").includes(`- ${label(b)}, topic lexing, scope src/lexer.ts,`), listed);
    assert.ok((detail ?? "").startsWith(`Agent ${label(b)} (${b.agent.agent_id}, "Lexer"), worker, model test/model. Run ${b.run.run_id}: running after `), detail);
    assert.match(detail ?? "", /\nTopic: lexing\. Scope: src\/lexer\.ts\.\n/);
    assert.match(detail ?? "", /\nPeer messages received in this run \(1\):\n- \[msg_[0-9a-f]{12}\] from Parser#[0-9a-f]{8}, question, about src\/lexer\.ts\nsummary: who owns the lexer\ntext:\nWho owns src\/lexer\.ts\? See line 40\.\n/);
    assert.match(detail ?? "", /\nOpen questions asked to it \(1\):\n- from Parser#[0-9a-f]{8} about src\/lexer\.ts \(msg_[0-9a-f]{12}\)\n/);
    const own_detail = await get_agent_status_tool.execute(tool_context(chat_id, "main"), { agent_id: label(a) });
    assert.match(own_detail.text, /\nPeer messages sent in this run \(1\):\n- \[msg_[0-9a-f]{12}\] to Lexer#[0-9a-f]{8}, question, about src\/lexer\.ts, delivered to the recipient's inbox\nsummary: who owns the lexer\ntext:\nWho owns src\/lexer\.ts\? See line 40\.\n/);
    assert.match(own_detail.text, /\nReport file: /);
    const main_list = await list_agents_tool.execute(tool_context(chat_id, "main"), {});
    assert.match(main_list.text, /^Agents in this chat at \d\d:\d\d\. You are the main agent; these are your sub-agents\.\n/);
  } finally {
    await stop_chat(chat_id);
  }
});
