import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { agent_label, short_agent_id } from "../shared/peer-notes.ts";
import { create_live, forget_live, live_run } from "../electron/agents/live.ts";
import { send_peer } from "../electron/agents/peers.ts";
import { cancel_agent, continue_agent, deploy_agent, message_agent } from "../electron/agents/runner.ts";
import { begin_run, create_agent, end_run, get_agent } from "../electron/agents/store.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import { message_agent_tool } from "../electron/tools/agents/manage.ts";
import { message_peer_tool } from "../electron/tools/agents/message-peer.ts";
import { ToolArgumentError, type PeerRequest, type Tool } from "../electron/tools/types.ts";
import { block_until_abort, completed, model, project, request, scripts, start_runner, stop_runner, tools, wait_for } from "./agents-runner-harness.ts";
import { allowed_peer_tool, calls, deferred, is_peer_note, label, notices, parked, peer_request, peer_views, reported, run_context, sender_of, stepper, stop_all, tool_context, view_of } from "./peer-flow-kit.ts";

before(start_runner);

after(stop_runner);

const released = new Map<string, ReturnType<typeof deferred>>();

const slow_tool: Tool = {
  spec: { name: "pf_slow", description: "", parameters: { type: "object", properties: {} } },
  profiles: ["worker", "explore"],
  available: () => true,
  execute: async (_ctx, raw) => {
    await released.get(String(raw.key))?.promise;
    return { status: "done", text: "slow tool finished", view: null };
  },
};

tools.push(allowed_peer_tool, slow_tool);

scripts.set("pf park", block_until_abort);

test("message_peer reaches the recipient as Name#id, short id and full id, and refuses itself, main, a bare name and agents of other chats", async () => {
  const a = deploy_agent(request("pf park", { chat_id: "pf-address", name: "Sender" }));
  const b = deploy_agent(request("pf park", { chat_id: "pf-address", name: "Target" }));
  const elsewhere = deploy_agent(request("pf park", { chat_id: "pf-address-other", name: "Elsewhere" }));
  await parked(a, b, elsewhere);
  try {
    for (const to of [label(b), short_agent_id(b.agent.agent_id), b.agent.agent_id, `  ${label(b)} `]) {
      const result = await send_peer(sender_of(a), peer_request(to, "info", `addressed as ${to}`));
      assert.equal(result.status, "done", `${to}: ${result.text}`);
      assert.equal(view_of(result).to_id, b.agent.agent_id);
      assert.equal(view_of(result).outcome, "queued");
    }
    assert.equal(live_run(b.run.run_id)?.inbox.filter((entry) => entry.from === "peer").length, 4);
    const own = await send_peer(sender_of(a), peer_request(label(a), "info", "to myself"));
    assert.equal(own.status, "failed");
    assert.match(own.text, /^That is your own id/);
    const main = await send_peer(sender_of(a), peer_request("main", "question", "to main"));
    assert.equal(main.status, "failed");
    assert.equal(main.text, "The main agent is not a peer; reach it with message_main_agent.");
    const foreign = await send_peer(sender_of(a), peer_request(label(elsewhere), "info", "across chats"));
    assert.equal(foreign.status, "failed");
    assert.match(foreign.text, /^No agent Elsewhere#[0-9a-f]{8} exists in this chat\.$/);
    const bare = await send_peer(sender_of(a), peer_request("Target", "info", "by name"));
    assert.equal(bare.status, "failed");
    assert.equal(live_run(elsewhere.run.run_id)?.inbox.length, 0);
  } finally {
    await stop_all(a, b, elsewhere);
  }
});

test("message_peer validates type, about, summary and in_reply_to at the boundary and passes a long text through uncut", async () => {
  const sent: PeerRequest[] = [];
  const ctx = tool_context("pf-validate", "worker", {
    send_peer: async (peer_request) => {
      sent.push(peer_request);
      return { status: "done", text: "ok", view: null };
    },
  });
  const base = { to: "Lexer#3f2a91c0", type: "info", about: "src/a.ts", summary: "one line", text: "body" };
  assert.deepEqual(message_peer_tool.profiles, ["explore", "worker"]);
  assert.throws(() => message_peer_tool.execute(ctx, { ...base, type: "note" }), (error) => error instanceof ToolArgumentError && /type must be info, question or answer/.test(error.message));
  assert.throws(() => message_peer_tool.execute(ctx, { ...base, about: undefined }), ToolArgumentError);
  assert.throws(() => message_peer_tool.execute(ctx, { ...base, about: "   " }), /about must not be blank/);
  assert.throws(() => message_peer_tool.execute(ctx, { ...base, summary: "" }), /summary (is required|must not be blank)/);
  assert.throws(() => message_peer_tool.execute(ctx, { ...base, type: "answer" }), /in_reply_to is required for type answer/);
  assert.throws(() => message_peer_tool.execute(ctx, { ...base, type: "answer", in_reply_to: "  " }), /in_reply_to is required for type answer/);
  const long_text = `${"x".repeat(300_000)}END`;
  await message_peer_tool.execute(ctx, { ...base, about: "src/a.ts\n  line 4", summary: "two\nlines", text: long_text });
  await message_peer_tool.execute(ctx, { ...base, type: "answer", in_reply_to: " msg_0123456789ab " });
  assert.equal(sent[0]?.about, "src/a.ts line 4");
  assert.equal(sent[0]?.summary, "two lines");
  assert.equal(sent[0]?.text, long_text);
  assert.equal(sent[1]?.in_reply_to, "msg_0123456789ab");
  const main = await message_peer_tool.execute(tool_context("pf-validate", "main"), base);
  assert.equal(main.status, "failed");
});

test("a message for an agent inside a running tool waits for that tool and arrives at the next round boundary", async () => {
  released.set("boundary", deferred());
  let seen: ApiMessage[] = [];
  scripts.set(
    "pf boundary R",
    stepper([
      async () => calls(["pf_slow", { key: "boundary" }]),
      async (messages) => {
        seen = messages;
        return completed({ content: "R done" });
      },
    ]),
  );
  const s = deploy_agent(request("pf park", { chat_id: "pf-boundary", name: "Sender" }));
  const r = deploy_agent(request("pf boundary R", { chat_id: "pf-boundary", name: "Receiver" }));
  await parked(s);
  await wait_for(() => (live_run(r.run.run_id)?.transcript.steps ?? []).some((step) => step.kind === "tool" && step.name === "pf_slow" && step.status === "running"));
  try {
    const result = await send_peer(sender_of(s), peer_request(label(r), "info", "token kinds live in tokens.ts line 12"));
    assert.equal(view_of(result).outcome, "queued");
    assert.match(result.text, /^In the inbox of Receiver#[0-9a-f]{8} as msg_[0-9a-f]{12}; it arrives at its next round boundary\. Keep working\.$/);
    assert.equal(live_run(r.run.run_id)?.inbox.length, 1);
    assert.equal(notices(r.run.run_id, "peer_message").length, 0);
    released.get("boundary")?.resolve();
    await reported(r.run.run_id);
    const tool_at = seen.findIndex((message) => message.role === "tool" && String(message.content).includes("slow tool finished"));
    const note_at = seen.findIndex(is_peer_note);
    assert.ok(tool_at >= 0 && note_at > tool_at, `tool result at ${tool_at}, peer note at ${note_at}`);
    assert.deepEqual(
      notices(r.run.run_id, "peer_message").map((notice) => notice.round),
      [1],
    );
  } finally {
    await stop_all(s);
  }
});

test("a message that came back unread is delivered again when the sender repeats it to the continued recipient", async () => {
  const again = deferred();
  const ids = { b: "" };
  const message = (to: string) => ["message_peer", { to, type: "info", about: "src/a.ts", summary: "token kind lives in a.ts", text: "src/a.ts line 4 decides the token kind" }] as [string, Record<string, unknown>];
  scripts.set("pf dup B", block_until_abort);
  scripts.set(
    "pf dup A",
    stepper([
      async () => calls(message(ids.b)),
      async () => {
        await again.promise;
        return calls(message(ids.b));
      },
      async () => completed({ content: "A done" }),
    ]),
  );
  const b = deploy_agent(request("pf dup B", { chat_id: "pf-dup", name: "Busy" }));
  ids.b = label(b);
  await parked(b);
  const a = deploy_agent(request("pf dup A", { chat_id: "pf-dup", name: "Asker" }));
  await wait_for(() => peer_views(a.run.run_id).length === 1);
  assert.equal(peer_views(a.run.run_id)[0]?.view.outcome, "queued");
  const busy = get_agent(b.agent.agent_id);
  assert.ok(busy);
  cancel_agent(busy);
  await wait_for(() => live_run(b.run.run_id) === null);
  const next = await continue_agent(busy, run_context("pf-dup", "pf dup B again"));
  try {
    again.resolve();
    await reported(a.run.run_id);
    assert.ok(notices(a.run.run_id, "peer_status").some((notice) => /^Busy#[0-9a-f]{8} ended before it read your message msg_/.test(notice.text)));
    const second = peer_views(a.run.run_id)[1];
    assert.equal(second?.view.outcome, "queued", second?.text);
    const unread = live_run(next.run.run_id)?.inbox.filter((entry) => entry.from === "peer").length ?? 0;
    assert.equal(unread + notices(next.run.run_id, "peer_message").length, 1);
  } finally {
    await stop_all(next);
  }
});

test("an asked agent that ends with the question still unread tells the running asker once about that question", async () => {
  const a = deploy_agent(request("pf park", { chat_id: "pf-once", name: "Asker" }));
  const b = deploy_agent(request("pf park", { chat_id: "pf-once", name: "Asked" }));
  await parked(a, b);
  try {
    const result = await send_peer(sender_of(a), peer_request(label(b), "question", "Who changes TokenKind?"));
    const message_id = view_of(result).message_id;
    const asked = get_agent(b.agent.agent_id);
    assert.ok(asked);
    cancel_agent(asked);
    await wait_for(() => live_run(b.run.run_id) === null);
    const about_it = (live_run(a.run.run_id)?.inbox ?? []).flatMap((entry) => (entry.from === "app" && entry.text.includes(message_id) ? [entry.text] : []));
    assert.equal(about_it.length, 1, about_it.join(" | "));
  } finally {
    await stop_all(a);
  }
});

test("after the end event message_agent and message_peer refuse an info, an answer is held, and nothing waits in the dead inbox", async () => {
  const agent = create_agent({ chat_id: "pf-ended", name: "Ender", description: "ends", topic: "x", scope: [], model: model.id, effort: "", profile: "worker", without_tools: [], project_root: project });
  const run = begin_run(agent, "task", "parent");
  const live = create_live(agent.agent_id, run.run_id, agent.chat_id);
  live.emit({ type: "end", status: "done", error: null });
  const s = deploy_agent(request("pf park", { chat_id: "pf-ended", name: "Sender" }));
  await parked(s);
  try {
    assert.equal(message_agent(agent, "late instruction"), false);
    assert.equal(live.inbox.length, 0);
    const steered = await message_agent_tool.execute(tool_context("pf-ended", "main"), { agent_id: agent.agent_id, text: "late instruction" });
    assert.equal(steered.status, "failed");
    const info = await send_peer(sender_of(s), peer_request(agent_label(agent.name, agent.agent_id), "info", "late info"));
    assert.equal(info.status, "failed");
    assert.equal(view_of(info).outcome, "not_running");
    const reply = await send_peer(sender_of(s), peer_request(agent_label(agent.name, agent.agent_id), "answer", "late answer", "msg_000000000001"));
    assert.equal(view_of(reply).outcome, "held");
    assert.equal(get_agent(agent.agent_id)?.held.length, 1);
    assert.equal(live.inbox.length, 0);
    assert.doesNotMatch(steered.text, /not running \(running\)/);
    assert.doesNotMatch(info.text, /not running \(running\)/);
  } finally {
    end_run(agent.agent_id, run.run_id, "completed", "");
    forget_live(run.run_id);
    await stop_all(s);
  }
});
