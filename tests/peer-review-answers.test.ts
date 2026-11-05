import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { agent_label, type PeerType } from "../shared/peer-notes.ts";
import { live_run } from "../electron/agents/live.ts";
import { send_peer } from "../electron/agents/peers.ts";
import { questions_asked_by } from "../electron/agents/questions.ts";
import { current_run } from "../electron/agents/records.ts";
import { cancel_agent, deploy_agent } from "../electron/agents/runner.ts";
import { get_agent } from "../electron/agents/store.ts";
import type { PeerRequest, Tool } from "../electron/tools/types.ts";
import { block_until_abort, completed, events, reports, request, scripts, start_runner, stop_runner, tools, wait_for } from "./agents-runner-harness.ts";

before(start_runner);

after(stop_runner);

const peer_tool: Tool = {
  spec: { name: "message_peer", description: "", parameters: { type: "object", properties: {} } },
  profiles: ["worker"],
  available: () => true,
  execute: async (ctx, raw) => {
    if (!ctx.send_peer) {
      throw new Error("no peer hook");
    }
    const parsed: PeerRequest = {
      to: String(raw.to),
      type: raw.type as PeerType,
      about: String(raw.about),
      summary: String(raw.summary),
      text: String(raw.text),
      in_reply_to: typeof raw.in_reply_to === "string" ? raw.in_reply_to : null,
    };
    return ctx.send_peer(parsed);
  },
};

test("two different questions answered with the same short text both get their answer", async () => {
  tools.push(peer_tool);
  try {
    const chat_id = "chat-same-answer";
    scripts.set("asker park", block_until_abort);
    const asker = deploy_agent(request("asker park", { chat_id, name: "Asker", topic: "parser" }));
    await wait_for(() => events.some((event) => event.run_id === asker.run.run_id && event.type === "context"));
    const ids: string[] = [];
    let answerer_label = "";
    let round = 0;
    scripts.set("answerer", async () => {
      round += 1;
      if (round === 1) {
        await wait_for(() => ids.length === 2);
      }
      const reply_to = ids[round - 1];
      if (!reply_to) {
        return completed({ content: "answered both" });
      }
      const call = { to: agent_label(asker.agent.name, asker.agent.agent_id), type: "answer", about: "tokens.ts", summary: "yes", text: "Yes.", in_reply_to: reply_to };
      return completed({ tool_calls: [{ index: 0, id: `a${round}`, name: "message_peer", arguments: JSON.stringify(call) }], finish_reason: "tool_calls" });
    });
    const answerer = deploy_agent(request("answerer", { chat_id, name: "Answerer", topic: "parser" }));
    answerer_label = agent_label(answerer.agent.name, answerer.agent.agent_id);
    const asker_agent = get_agent(asker.agent.agent_id);
    const asker_run = asker_agent ? current_run(asker_agent) : null;
    const asker_live = asker_run ? live_run(asker_run.run_id) : null;
    assert.ok(asker_agent && asker_run && asker_live);
    for (const text of ["Do you own tokens.ts?", "Will you change TokenKind?"]) {
      const sent = await send_peer({ agent: asker_agent, run: asker_run, live: asker_live }, { to: answerer_label, type: "question", about: "tokens.ts", summary: text, text, in_reply_to: null });
      ids.push(sent.view?.kind === "peer_message" ? sent.view.message_id : "");
    }
    await wait_for(() => reports.some((report) => report.run_id === answerer.run.run_id));
    const outcomes = events.flatMap((event) => (event.run_id === answerer.run.run_id && event.type === "tool_end" && event.view?.kind === "peer_message" ? [event.view.outcome] : []));
    assert.deepEqual(outcomes, ["queued", "queued"]);
    assert.deepEqual(questions_asked_by(asker.agent.agent_id), []);
    cancel_agent(asker_agent);
    await wait_for(() => live_run(asker.run.run_id) === null);
  } finally {
    tools.pop();
  }
});
