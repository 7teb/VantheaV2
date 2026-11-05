import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { after, before, test } from "node:test";
import { live_run } from "../electron/agents/live.ts";
import { send_peer } from "../electron/agents/peers.ts";
import { questions_asked_by } from "../electron/agents/questions.ts";
import { continue_agent, deploy_agent } from "../electron/agents/runner.ts";
import { get_agent } from "../electron/agents/store.ts";
import { completed, reports, request, scripts, start_runner, stop_runner, tools, block_until_abort, wait_for } from "./agents-runner-harness.ts";
import { allowed_peer_tool, calls, deferred, label, notices, parked, peer_request, peer_views, reported, run_context, sender_of, stepper, stop_all } from "./peer-flow-kit.ts";

before(start_runner);

after(stop_runner);

tools.push(allowed_peer_tool);

scripts.set("pf2 park", block_until_abort);

test("a peer info that lands while an agent writes its final report does not replace that report with the reply to the info", async () => {
  const peer = deploy_agent(request("pf2 park", { chat_id: "pf2-report", name: "Peer" }));
  await parked(peer);
  const ids = { writer: "" };
  scripts.set(
    "pf2 writer",
    stepper([
      async () => {
        await send_peer(sender_of(peer), peer_request(ids.writer, "info", "lexer.ts moved to src/parser/lex/"));
        return completed({ content: "FULL REPORT: the parser accepts three token kinds, defined in src/parser/tokens.ts:12." });
      },
      async () => completed({ content: "Noted, nothing changes for my task." }),
    ]),
  );
  const writer = deploy_agent(request("pf2 writer", { chat_id: "pf2-report", name: "Writer" }));
  ids.writer = label(writer);
  try {
    await reported(writer.run.run_id);
    const report = reports.find((entry) => entry.run_id === writer.run.run_id);
    const text = await fs.readFile(report?.report_path ?? "", "utf8");
    assert.match(text, /FULL REPORT: the parser accepts three token kinds/, `the report the main agent gets is: ${JSON.stringify(text)}`);
  } finally {
    await stop_all(peer);
  }
});

test("a question the asked agent read but closed without an answer can be asked again of its continued run", async () => {
  const ids = { b: "" };
  const again = deferred();
  const question = () => ["message_peer", { to: ids.b, type: "question", about: "src/parser/tokens.ts", summary: "who changes TokenKind", text: "Who changes TokenKind?" }] as [string, Record<string, unknown>];
  scripts.set(
    "pf2 asked B",
    stepper([
      async () => {
        await wait_for(() => (live_run(b.run.run_id)?.inbox.length ?? 0) > 0);
        return completed({ content: "" });
      },
      async () => completed({ content: "B finished its own task without answering" }),
      block_until_abort,
    ]),
  );
  scripts.set(
    "pf2 asker A",
    stepper([
      async () => calls(question()),
      async () => {
        await again.promise;
        return calls(question());
      },
      async () => completed({ content: "A done" }),
    ]),
  );
  const b = deploy_agent(request("pf2 asked B", { chat_id: "pf2-reask", name: "Asked" }));
  ids.b = label(b);
  const a = deploy_agent(request("pf2 asker A", { chat_id: "pf2-reask", name: "Asker" }));
  await reported(b.run.run_id);
  await wait_for(() => questions_asked_by(a.agent.agent_id).length === 0);
  const asked = get_agent(b.agent.agent_id);
  assert.ok(asked);
  const next = await continue_agent(asked, run_context("pf2-reask", "pf2 asked B again"));
  try {
    again.resolve();
    await reported(a.run.run_id);
    assert.ok(notices(a.run.run_id, "peer_status").some((notice) => notice.text.includes("ended without an answer to your question")), "the asker was told the question closed without an answer");
    const second = peer_views(a.run.run_id)[1];
    assert.equal(second?.view.outcome, "queued", second?.text);
  } finally {
    await stop_all(next);
  }
});
