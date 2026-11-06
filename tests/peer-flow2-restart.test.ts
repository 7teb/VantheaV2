import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { live_run, live_runs } from "../electron/agents/live.ts";
import { send_peer } from "../electron/agents/peers.ts";
import { questions_asked_by } from "../electron/agents/questions.ts";
import { drop_agent_notes } from "../electron/agents/reports.ts";
import { roster_entries, roster_text } from "../electron/agents/roster.ts";
import { cancel_agent, continue_agent, deploy_agent, shutdown_agents_sync } from "../electron/agents/runner.ts";
import { get_agent, init_agent_store } from "../electron/agents/store.ts";
import { list_agents_tool } from "../electron/tools/agents/list.ts";
import { get_agent_status_tool } from "../electron/tools/agents/manage.ts";
import { block_until_abort, completed, events, request, root, scripts, start_runner, stop_runner, tools, wait_for } from "./agents-runner-harness.ts";
import { allowed_peer_tool, calls, deferred, kept_peer, label, parked, peer_request, reported, run_context, sender_of, stepper, stop_all, tool_context, view_of } from "./peer-flow-kit.ts";

before(start_runner);

after(stop_runner);

tools.push(allowed_peer_tool);

scripts.set("pf2 park", block_until_abort);

const app_notes = (run_id: string) => (live_run(run_id)?.inbox ?? []).flatMap((entry) => (entry.from === "app" ? [entry.text] : []));

test("cancelling an asked agent with one read and one unread question tells the running asker exactly once per question", async () => {
  const asker = deploy_agent(request("pf2 park", { chat_id: "pf2-cancel", name: "Asker" }));
  let read_first = false;
  const sent = deferred();
  scripts.set(
    "pf2 asked",
    stepper([
      async (_messages, signal) => {
        await Promise.race([sent.promise, new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))]);
        return completed({ content: "" });
      },
      async (messages, signal) => {
        read_first = messages.some((message) => message.role === "user" && String(message.content).includes("Who changes TokenKind?"));
        return block_until_abort(messages, signal);
      },
    ]),
  );
  const asked = deploy_agent(request("pf2 asked", { chat_id: "pf2-cancel", name: "Asked" }));
  await parked(asker, asked);
  try {
    const first = view_of(await send_peer(sender_of(asker), peer_request(label(asked), "question", "Who changes TokenKind?")));
    sent.resolve();
    await wait_for(() => read_first);
    const second = view_of(await send_peer(sender_of(asker), { ...peer_request(label(asked), "question", "Who owns lexer.ts?"), about: "src/parser/lexer.ts" }));
    const agent = get_agent(asked.agent.agent_id);
    assert.ok(agent);
    cancel_agent(agent);
    await wait_for(() => live_runs().every((live) => live.agent_id !== asked.agent.agent_id));
    const notes = app_notes(asker.run.run_id);
    assert.equal(notes.filter((text) => text.includes(first.message_id)).length, 1, notes.join("\n"));
    assert.equal(notes.filter((text) => text.includes(second.message_id)).length, 1, notes.join("\n"));
    assert.ok(notes.some((text) => text.includes(`ended without an answer to your question ${first.message_id}`)), notes.join("\n"));
    assert.ok(notes.some((text) => text.includes(`ended before it read your message ${second.message_id}`)), notes.join("\n"));
    assert.equal(questions_asked_by(asker.agent.agent_id).length, 0);
  } finally {
    await stop_all(asker);
  }
});

test("a continued agent whose question from the earlier run is still open shows it on its running run", async () => {
  const asked = deploy_agent(request("pf2 park", { chat_id: "pf2-open", name: "Asked" }));
  scripts.set(
    "pf2 ask once",
    stepper([
      async () => calls(["message_peer", { to: label(asked), type: "question", about: "src/parser/tokens.ts", summary: "who changes TokenKind", text: "Who changes TokenKind?" }]),
      async () => completed({ content: "asked, ending" }),
      block_until_abort,
    ]),
  );
  await parked(asked);
  const asker = deploy_agent(request("pf2 ask once", { chat_id: "pf2-open", name: "Asker" }));
  try {
    await reported(asker.run.run_id);
    const agent = get_agent(asker.agent.agent_id);
    assert.ok(agent);
    const next = await continue_agent(agent, run_context("pf2-open", "pf2 continue"));
    await wait_for(() => events.some((event) => event.run_id === next.run.run_id && event.type === "context"));
    assert.equal(questions_asked_by(asker.agent.agent_id).length, 1);
    assert.match(roster_text(roster_entries("pf2-open"), null), /Asker#[0-9a-f]{8}, topic none[^\n]*Open questions: to Asked#/);
    assert.equal(get_agent(asker.agent.agent_id)?.runs.at(-1)?.open_questions, 1, "the running run shows no open question although the agent still has one");
  } finally {
    await stop_all(asked, asker);
  }
});

test("after a restart the main agent can still find the answer that is kept for an agent that was running when the app closed", async () => {
  await wait_for(() => live_runs().length === 0);
  const a = deploy_agent(request("pf2 park", { chat_id: "pf2-restart", name: "Asker" }));
  const b = deploy_agent(request("pf2 park", { chat_id: "pf2-restart", name: "Answerer" }));
  await parked(a, b);
  const result = await send_peer(sender_of(b), peer_request(label(a), "answer", "TokenKind has three values.", "msg_00000000bbbb"));
  const message_id = view_of(result).message_id;
  shutdown_agents_sync();
  await wait_for(() => live_runs().length === 0);
  drop_agent_notes("pf2-restart");
  await init_agent_store(path.join(root, "agents"));
  assert.equal(kept_peer(get_agent(a.agent.agent_id)?.held[0])?.message_id, message_id);
  const main = tool_context("pf2-restart", "main");
  const listed = await list_agents_tool.execute(main, {});
  const status_a = await get_agent_status_tool.execute(main, { agent_id: label(a) });
  const status_b = await get_agent_status_tool.execute(main, { agent_id: label(b) });
  const surfaces = [listed.text, status_a.text, status_b.text];
  assert.ok(
    surfaces.some((text) => text.includes(message_id) && /kept|held/i.test(text)),
    `no surface of the main agent names the kept answer ${message_id}:\n${surfaces.map((text) => text.slice(0, 1200)).join("\n-----\n")}`,
  );
});
