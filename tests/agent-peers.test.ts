import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { agent_label, type PeerType } from "../shared/peer-notes.ts";
import { live_run, live_runs } from "../electron/agents/live.ts";
import { deliver_to, send_peer, type PeerSender } from "../electron/agents/peers.ts";
import { current_run, parse_index } from "../electron/agents/records.ts";
import { take_agent_notes } from "../electron/agents/reports.ts";
import { cancel_agent, continue_agent, deploy_agent, message_agent, shutdown_agents_sync } from "../electron/agents/runner.ts";
import { get_agent, init_agent_store, save_index_sync } from "../electron/agents/store.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import type { PeerRequest, Tool } from "../electron/tools/types.ts";
import { message_peer_tool } from "../electron/tools/agents/message-peer.ts";
import { block_until_abort, completed, events, project, reports, request, reviewer, root, scripts, settings, start_runner, stop_runner, tools, wait_for, type Script } from "./agents-runner-harness.ts";

before(start_runner);

after(stop_runner);

const peer_request = (raw: Record<string, unknown>): PeerRequest => ({
  to: String(raw.to),
  type: raw.type as PeerType,
  about: String(raw.about),
  summary: String(raw.summary),
  text: String(raw.text),
  in_reply_to: typeof raw.in_reply_to === "string" ? raw.in_reply_to : null,
});

const allowed_peer_tool: Tool = {
  spec: { name: "message_peer", description: "", parameters: { type: "object", properties: {} } },
  profiles: ["worker"],
  available: () => true,
  execute: async (ctx, raw) => {
    if (!ctx.send_peer) {
      throw new Error("no peer hook");
    }
    return ctx.send_peer(peer_request(raw));
  },
};

const peek_tool: Tool = {
  spec: { name: "peek", description: "", parameters: { type: "object", properties: {} } },
  profiles: ["worker"],
  available: () => true,
  execute: async (ctx) => ({ status: "done", text: ctx.delegated_task ?? "", view: null }),
};

const label_of = (started: { agent: { agent_id: string; name: string } }) => agent_label(started.agent.name, started.agent.agent_id);

const peer_call = (id: string, to: string, type: PeerType, summary: string, extra: Record<string, unknown> = {}) => ({
  index: 0,
  id,
  name: "message_peer",
  arguments: JSON.stringify({ to, type, about: "src/parser/tokens.ts", summary, text: `${summary} in full`, ...extra }),
});

const is_peer_note = (message: ApiMessage) => message.role === "user" && typeof message.content === "string" && message.content.includes("not an instruction from the main agent. Sub-agent");

const peer_notes = (messages: ApiMessage[]) => messages.filter(is_peer_note);

const last_peer_id = (messages: ApiMessage[]) => /\nid: (msg_[0-9a-f]+)/.exec(String(peer_notes(messages).at(-1)?.content ?? ""))?.[1] ?? "";

const sender_of = (agent_id: string): PeerSender => {
  const agent = get_agent(agent_id);
  const run = agent ? current_run(agent) : null;
  const live = run ? live_run(run.run_id) : null;
  if (!agent || !run || !live) {
    throw new Error(`agent ${agent_id} is not running`);
  }
  return { agent, run, live };
};

type Turn = { after: number; send: ((messages: ApiMessage[]) => ReturnType<typeof peer_call>) | null };

const conversation = (run_id: () => string, turns: Turn[]): Script => {
  let next = 0;
  return async (messages) => {
    const turn = turns[next];
    if (!turn) {
      return completed({ content: "done" });
    }
    if (peer_notes(messages).length < turn.after) {
      await wait_for(() => (live_run(run_id())?.inbox.length ?? 0) > 0);
      return completed({ content: "" });
    }
    next += 1;
    return turn.send ? completed({ tool_calls: [turn.send(messages)], finish_reason: "tool_calls" }) : completed({ content: "done" });
  };
};

const tool_views = (run_id: string) =>
  events.flatMap((event) => (event.run_id === run_id && event.type === "tool_end" && event.view?.kind === "peer_message" ? [{ view: event.view, text: event.result_text }] : []));

const notices = (run_id: string, notice: string) => events.flatMap((event) => (event.run_id === run_id && event.type === "notice" && event.notice === notice ? [event.text] : []));

const digests = (chat_id: string) => take_agent_notes(chat_id).flatMap((note) => (note.kind === "notice" && note.notice === "peer_digest" ? [note.text] : []));

const finished = (run_id: string) => wait_for(() => live_run(run_id) === null);

const parked = (...run_ids: string[]) => wait_for(() => run_ids.every((run_id) => events.some((event) => event.run_id === run_id && event.type === "context")));

test("messages between agents never call the review, and an identical repeat is not delivered and names the earlier message", async () => {
  tools.push(message_peer_tool);
  const calls_before = reviewer.calls.length;
  let b_run = "";
  scripts.set("dup B", conversation(() => b_run, [{ after: 1, send: null }]));
  const b = deploy_agent(request("dup B", { chat_id: "chat-dup", name: "Lexer", topic: "parser" }));
  b_run = b.run.run_id;
  scripts.set("dup A", conversation(() => "", [{ after: 0, send: () => peer_call("d1", label_of(b), "info", "TokenKind moves") }, { after: 0, send: () => peer_call("d2", label_of(b), "info", "TokenKind moves") }]));
  const a = deploy_agent(request("dup A", { chat_id: "chat-dup", name: "Parser", topic: "parser" }));
  await wait_for(() => reports.some((report) => report.run_id === a.run.run_id) && reports.some((report) => report.run_id === b_run));
  assert.equal(reviewer.calls.length - calls_before, 0);
  const [first, second] = tool_views(a.run.run_id);
  assert.equal(first?.view.kind === "peer_message" ? first.view.outcome : "", "queued");
  assert.equal(second?.view.kind === "peer_message" ? second.view.outcome : "", "duplicate");
  const first_id = first?.view.kind === "peer_message" ? first.view.message_id : "";
  assert.match(second?.text ?? "", new RegExp(`^Not sent again: the text is identical to ${first_id}, which already reached Lexer#`));
  assert.equal(notices(b_run, "peer_message").length, 1);
  tools.pop();
});

test("three messages without work in between nudge both agents, never the main agent, and are all delivered", async () => {
  tools.push(allowed_peer_tool);
  let a_run = "";
  let b_run = "";
  const b_label = { value: "" };
  const a_label = { value: "" };
  scripts.set("loop A", conversation(() => a_run, [{ after: 0, send: () => peer_call("l1", b_label.value, "info", "m1") }, { after: 1, send: () => peer_call("l3", b_label.value, "info", "m3") }]));
  scripts.set("loop B", conversation(() => b_run, [{ after: 1, send: () => peer_call("l2", a_label.value, "info", "m2") }, { after: 2, send: null }]));
  const b = deploy_agent(request("loop B", { chat_id: "chat-loop", name: "Lexer" }));
  b_run = b.run.run_id;
  b_label.value = label_of(b);
  const a = deploy_agent(request("loop A", { chat_id: "chat-loop", name: "Parser" }));
  a_run = a.run.run_id;
  a_label.value = label_of(a);
  await wait_for(() => reports.some((report) => report.run_id === a_run) && reports.some((report) => report.run_id === b_run));
  assert.deepEqual([...tool_views(a_run), ...tool_views(b_run)].map((entry) => (entry.view.kind === "peer_message" ? entry.view.outcome : "")), ["queued", "queued", "queued"]);
  assert.equal(notices(b_run, "peer_message").length, 2);
  assert.match(notices(a_run, "peer_status").join("\n"), /You and Lexer#[0-9a-f]{8} are messaging each other without working in between\. Continue with your task; an open disagreement belongs in your report\./);
  assert.match(notices(b_run, "peer_status").join("\n"), /You and Parser#[0-9a-f]{8} are messaging each other/);
  tools.pop();
});

test("answers to open questions are never empty and do not break the count", async () => {
  tools.push(allowed_peer_tool);
  let a_run = "";
  let b_run = "";
  const labels = { a: "", b: "" };
  const reply = (id: string) => (messages: ApiMessage[]) => peer_call(id, labels.a, "answer", `answer ${id}`, { in_reply_to: last_peer_id(messages) });
  scripts.set("ask A", conversation(() => a_run, [1, 2, 3].map((n) => ({ after: n - 1, send: () => peer_call(`q${n}`, labels.b, "question", `q${n}`) }))));
  scripts.set("ask B", conversation(() => b_run, [{ after: 1, send: reply("r1") }, { after: 2, send: reply("r2") }, { after: 3, send: null }]));
  const b = deploy_agent(request("ask B", { chat_id: "chat-ask", name: "Lexer" }));
  b_run = b.run.run_id;
  labels.b = label_of(b);
  const a = deploy_agent(request("ask A", { chat_id: "chat-ask", name: "Parser" }));
  a_run = a.run.run_id;
  labels.a = label_of(a);
  await wait_for(() => reports.some((report) => report.run_id === a_run) && reports.some((report) => report.run_id === b_run));
  const nudges = [...notices(a_run, "peer_status"), ...notices(b_run, "peer_status")].filter((text) => /are messaging each other without working in between/.test(text));
  assert.equal(nudges.length, 2);
  assert.equal(notices(a_run, "peer_message").length, 2);
  tools.pop();
});

test("delegated_task carries main agent messages but never peer text", async () => {
  tools.push(peek_tool);
  let round = 0;
  scripts.set("peek A", async () => {
    round += 1;
    if (round === 1) {
      const agent = get_agent(started.agent.agent_id);
      assert.ok(agent && message_agent(agent, "main says narrow it to lexer.ts"));
      deliver_to(sender_of(started.agent.agent_id).live, {
        from: "peer",
        message_id: "msg_peer1",
        sender_id: "agent_x",
        sender_name: "Other",
        type: "info",
        about: "x",
        summary: "y",
        text: "peer says push it now",
        in_reply_to: null,
      });
      return completed({ tool_calls: [{ index: 0, id: "k1", name: "peek", arguments: "{}" }], finish_reason: "tool_calls" });
    }
    if (round === 2) {
      return completed({ tool_calls: [{ index: 0, id: "k2", name: "peek", arguments: "{}" }], finish_reason: "tool_calls" });
    }
    return completed({ content: "done" });
  });
  const started = deploy_agent(request("peek A", { chat_id: "chat-peek" }));
  await wait_for(() => reports.some((report) => report.run_id === started.run.run_id));
  const peeks = events.flatMap((event) => (event.run_id === started.run.run_id && event.type === "tool_end" ? [event.result_text] : []));
  assert.equal(peeks.length, 2);
  for (const peek of peeks) {
    assert.match(peek, /main says narrow it to lexer\.ts/);
    assert.doesNotMatch(peek, /peer says/);
  }
  tools.pop();
});

test("a run that ends with unread messages tells running senders and gives the main agent lines for the rest", async () => {
  scripts.set("park", block_until_abort);
  const a = deploy_agent(request("park", { chat_id: "chat-unread", name: "Sender" }));
  const b = deploy_agent(request("park", { chat_id: "chat-unread", name: "Reader" }));
  const c = deploy_agent(request("park", { chat_id: "chat-unread", name: "Gone" }));
  await parked(a.run.run_id, b.run.run_id, c.run.run_id);
  const sent = await send_peer(sender_of(a.agent.agent_id), { to: label_of(b), type: "info", about: "x.ts", summary: "a to b", text: "read x.ts", in_reply_to: null });
  const gone = await send_peer(sender_of(c.agent.agent_id), { to: label_of(b), type: "question", about: "y.ts", summary: "c to b", text: "who owns y.ts?", in_reply_to: null });
  assert.equal(sent.status, "done");
  assert.equal(gone.status, "done");
  const reader = get_agent(b.agent.agent_id);
  assert.ok(reader && message_agent(reader, "stop after this"));
  const gone_agent = get_agent(c.agent.agent_id);
  assert.ok(gone_agent);
  cancel_agent(gone_agent);
  await finished(c.run.run_id);
  digests("chat-unread");
  cancel_agent(reader);
  await finished(b.run.run_id);
  const inbox = live_run(a.run.run_id)?.inbox ?? [];
  assert.equal(inbox.length, 1);
  assert.match(inbox[0]?.from === "app" ? inbox[0].text : "", /^Reader#[0-9a-f]{8} ended before it read your message msg_[0-9a-f]+ \(info, about x\.ts\)\.$/);
  const lines = digests("chat-unread");
  assert.ok(lines.some((line) => /^Reader#[0-9a-f]{8} ended before it read your message_agent instruction: stop after this$/.test(line)));
  assert.ok(lines.some((line) => /^Reader#[0-9a-f]{8} ended before it read the message msg_[0-9a-f]+ \(Gone#[0-9a-f]{8} → Reader#[0-9a-f]{8}: question, about y\.ts: 'c to b'\); the sender has finished too\.$/.test(line)));
  const sender = get_agent(a.agent.agent_id);
  assert.ok(sender);
  cancel_agent(sender);
  await finished(a.run.run_id);
});

test("info to a finished agent fails with its status and a pointer to its report", async () => {
  scripts.set("quick", async () => completed({ content: "quick report" }));
  scripts.set("park", block_until_abort);
  const done = deploy_agent(request("quick", { chat_id: "chat-done", name: "Quick" }));
  await wait_for(() => reports.some((report) => report.run_id === done.run.run_id));
  const a = deploy_agent(request("park", { chat_id: "chat-done", name: "Sender" }));
  await parked(a.run.run_id);
  const result = await send_peer(sender_of(a.agent.agent_id), { to: label_of(done), type: "question", about: "x", summary: "s", text: "t", in_reply_to: null });
  assert.equal(result.status, "failed");
  assert.equal(result.view?.kind === "peer_message" ? result.view.outcome : "", "not_running");
  assert.match(result.text, /^Quick#[0-9a-f]{8} is not running \(completed\), so this question was not sent; only an answer reaches an agent that has finished\. get_agent_status with agent_id agent_/);
  const sender = get_agent(a.agent.agent_id);
  assert.ok(sender);
  cancel_agent(sender);
  await finished(a.run.run_id);
});

test("an agent that asked a question ends at once; the asked agent ending without an answer tells the running asker or the main agent", async () => {
  scripts.set("park", block_until_abort);
  let asked_label = "";
  scripts.set("asker ends", async () => {
    const result = await send_peer(sender_of(quick_asker.agent.agent_id), { to: asked_label, type: "question", about: "tokens.ts", summary: "who changes it", text: "Who changes TokenKind?", in_reply_to: null });
    assert.equal(result.status, "done");
    return completed({ content: "asker report" });
  });
  const read = () => events.filter((event) => event.run_id === asked.run.run_id && event.type === "notice" && event.notice === "peer_message").length;
  scripts.set("asked reads", async (messages, signal) => {
    await wait_for(() => read() + (live_run(asked.run.run_id)?.inbox.length ?? 0) >= 2);
    return read() >= 2 ? block_until_abort(messages, signal) : completed({ content: "" });
  });
  const asked = deploy_agent(request("asked reads", { chat_id: "chat-q", name: "Asked" }));
  const waiting_asker = deploy_agent(request("park", { chat_id: "chat-q", name: "Waiting" }));
  asked_label = label_of(asked);
  await parked(waiting_asker.run.run_id);
  const quick_asker = deploy_agent(request("asker ends", { chat_id: "chat-q", name: "Quick" }));
  await wait_for(() => reports.some((report) => report.run_id === quick_asker.run.run_id));
  assert.ok(live_run(asked.run.run_id) !== null);
  const report = await fs.readFile(reports.find((entry) => entry.run_id === quick_asker.run.run_id)?.report_path ?? "", "utf8");
  assert.match(report, /^asker report\n\nOpen questions of Quick#[0-9a-f]{8}:\n\n- Open question to Asked#[0-9a-f]{8} about tokens\.ts since \d\d:\d\d \(msg_[0-9a-f]+\), still without an answer\.$/);
  await send_peer(sender_of(waiting_asker.agent.agent_id), { to: asked_label, type: "question", about: "lexer.ts", summary: "s", text: "Who owns lexer.ts?", in_reply_to: null });
  await wait_for(() => read() === 2);
  digests("chat-q");
  const asked_agent = get_agent(asked.agent.agent_id);
  assert.ok(asked_agent);
  cancel_agent(asked_agent);
  await finished(asked.run.run_id);
  const inbox = live_run(waiting_asker.run.run_id)?.inbox ?? [];
  assert.ok(inbox.some((entry) => entry.from === "app" && /^Asked#[0-9a-f]{8} ended without an answer to your question msg_[0-9a-f]+ about lexer\.ts; get_agent_status with agent_id agent_/.test(entry.text)));
  assert.ok(digests("chat-q").some((line) => /^Asked#[0-9a-f]{8} ended without answering the question msg_[0-9a-f]+ of Quick#[0-9a-f]{8} about tokens\.ts; the asker has finished too\.$/.test(line)));
  const waiting = get_agent(waiting_asker.agent.agent_id);
  assert.ok(waiting);
  cancel_agent(waiting);
  await finished(waiting_asker.run.run_id);
});

test("two agents that ask each other both finish without waiting", async () => {
  const labels = { a: "", b: "" };
  const ids = { a: "", b: "" };
  const ask = (self: () => string, other: () => string): Script => {
    let asked = false;
    return async () => {
      if (!asked) {
        asked = true;
        await wait_for(() => ids.a !== "" && ids.b !== "" && live_run(ids.a) !== null && live_run(ids.b) !== null);
        await send_peer(sender_of(self()), { to: other(), type: "question", about: "shared.ts", summary: "who edits shared.ts", text: "Do you edit shared.ts?", in_reply_to: null });
      }
      return completed({ content: "report" });
    };
  };
  scripts.set("mutual A", ask(() => a.agent.agent_id, () => labels.b));
  scripts.set("mutual B", ask(() => b.agent.agent_id, () => labels.a));
  const a = deploy_agent(request("mutual A", { chat_id: "chat-mutual", name: "Left" }));
  const b = deploy_agent(request("mutual B", { chat_id: "chat-mutual", name: "Right" }));
  labels.a = label_of(a);
  labels.b = label_of(b);
  ids.a = a.run.run_id;
  ids.b = b.run.run_id;
  await wait_for(() => reports.some((report) => report.run_id === a.run.run_id) && reports.some((report) => report.run_id === b.run.run_id));
  assert.equal(reports.find((report) => report.run_id === a.run.run_id)?.status, "completed");
  assert.equal(reports.find((report) => report.run_id === b.run.run_id)?.status, "completed");
});

test("an answer to a finished agent is held, survives a restart and reaches its next run in round 0", async () => {
  scripts.set("park", block_until_abort);
  let first = true;
  let held_order: number[] = [];
  scripts.set("held asker", async (messages) => {
    if (first) {
      first = false;
      await send_peer(sender_of(asker.agent.agent_id), { to: label_of(answerer), type: "question", about: "tokens.ts", summary: "need TokenKind", text: "Which TokenKind values exist?", in_reply_to: null });
      return completed({ content: "asked and done" });
    }
    held_order = [messages.findIndex(is_peer_note), messages.findIndex((message) => message.role === "user" && message.content === "use the answer")];
    return completed({ content: "used the answer" });
  });
  const answerer = deploy_agent(request("park", { chat_id: "chat-held", name: "Answerer" }));
  await parked(answerer.run.run_id);
  const asker = deploy_agent(request("held asker", { chat_id: "chat-held", name: "Asker" }));
  await wait_for(() => reports.some((report) => report.run_id === asker.run.run_id));
  digests("chat-held");
  const question_id = /\(msg_[0-9a-f]+\)/.exec(await fs.readFile(reports.find((report) => report.run_id === asker.run.run_id)?.report_path ?? "", "utf8"))?.[0].slice(1, -1) ?? "";
  const result = await send_peer(sender_of(answerer.agent.agent_id), { to: label_of(asker), type: "answer", about: "tokens.ts", summary: "three kinds", text: "Ident, Number, Punct.", in_reply_to: question_id });
  assert.equal(result.status, "done");
  assert.equal(result.view?.kind === "peer_message" ? result.view.outcome : "", "held");
  assert.match(result.text, /^Asker#[0-9a-f]{8} has finished\. Your answer msg_[0-9a-f]+ is kept and reaches it when the main agent continues it/);
  assert.equal(get_agent(asker.agent.agent_id)?.held.length, 1);
  assert.ok(digests("chat-held").some((line) => /Answerer#[0-9a-f]{8} → Asker#[0-9a-f]{8}: answer, about tokens\.ts: 'three kinds'\. Asker#[0-9a-f]{8} has finished, so the answer msg_[0-9a-f]+ is kept for its next run; continue_agent with agent_id agent_/.test(line)));
  const answering = get_agent(answerer.agent.agent_id);
  assert.ok(answering);
  cancel_agent(answering);
  await wait_for(() => live_runs().length === 0);
  save_index_sync();
  const stored = parse_index(JSON.parse(await fs.readFile(path.join(root, "agents", "index.json"), "utf8")), new Date().toISOString());
  assert.equal(stored.records.find((record) => record.agent_id === asker.agent.agent_id)?.held[0]?.text, "Ident, Number, Punct.");
  await init_agent_store(path.join(root, "agents"));
  const reloaded = get_agent(asker.agent.agent_id);
  assert.equal(reloaded?.held.length, 1);
  assert.ok(reloaded);
  const next = await continue_agent(reloaded, {
    chat_id: "chat-held",
    parent_message_id: "parent-msg",
    parent_call_id: "parent-call",
    project_root: project,
    user_request: "the user's request",
    mode: "ask",
    settings,
    prompt: "use the answer",
  });
  await wait_for(() => reports.some((report) => report.run_id === next.run.run_id));
  assert.ok(held_order[0] !== undefined && held_order[0] >= 0 && held_order[0] < (held_order[1] ?? -1));
  assert.equal(get_agent(asker.agent.agent_id)?.held.length, 0);
  const round_zero = events.find((event) => event.run_id === next.run.run_id && event.type === "notice" && event.notice === "peer_message");
  assert.equal(round_zero?.type === "notice" ? round_zero.round : -1, 0);
});

test("closing the app reports unread messages into the sender's journal before the runs end", async () => {
  await wait_for(() => live_runs().length === 0);
  scripts.set("park", block_until_abort);
  const a = deploy_agent(request("park", { chat_id: "chat-close", name: "Writer" }));
  const b = deploy_agent(request("park", { chat_id: "chat-close", name: "Busy" }));
  await parked(a.run.run_id, b.run.run_id);
  await send_peer(sender_of(a.agent.agent_id), { to: label_of(b), type: "info", about: "x", summary: "s", text: "t", in_reply_to: null });
  shutdown_agents_sync();
  const own = events.filter((event) => event.run_id === a.run.run_id);
  const status = own.find((event) => event.type === "notice" && event.notice === "peer_status");
  const end = own.find((event) => event.type === "end");
  assert.match(status?.type === "notice" ? status.text : "", /^Busy#[0-9a-f]{8} ended before it read your message msg_[0-9a-f]+ \(info, about x\)\.$/);
  assert.ok(status && end && status.seq < end.seq);
  await wait_for(() => live_runs().length === 0);
});
