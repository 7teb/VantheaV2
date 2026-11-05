import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { PeerType } from "../shared/peer-notes.ts";
import { live_run } from "../electron/agents/live.ts";
import { send_peer } from "../electron/agents/peers.ts";
import { flush_reports, has_agent_notes, take_agent_notes, wait_for_input } from "../electron/agents/reports.ts";
import { deploy_agent } from "../electron/agents/runner.ts";
import * as agent_session from "../electron/agents/session.ts";
import { message_main_agent_tool } from "../electron/tools/agents/message-main.ts";
import type { PeerRequest, Tool } from "../electron/tools/types.ts";
import { register_active, unregister_active } from "../electron/turn/active.ts";
import { block_until_abort, completed, events, model, reports, request, scripts, start_runner, stop_runner, tools, updates, wait_for } from "./agents-runner-harness.ts";
import { allowed_peer_tool, calls, deferred, has_note, label, parked, reported, sender_of, sleep, stepper, stop_all } from "./peer-flow-kit.ts";

before(start_runner);

after(stop_runner);

const probe: Tool = {
  spec: { name: "pf_probe", description: "", parameters: { type: "object", properties: {} } },
  profiles: ["worker"],
  available: () => true,
  execute: async () => ({ status: "done", text: "probed", view: null }),
};

tools.push(allowed_peer_tool, probe, message_main_agent_tool);

const peer_count = (run_id: string) => events.filter((event) => event.run_id === run_id && event.type === "tool_end" && event.view?.kind === "peer_message").length;

const info = (to: string, text: string): PeerRequest => ({ to, type: "info" as PeerType, about: "src/a.ts", summary: text, text, in_reply_to: null });

scripts.set("pf park", block_until_abort);

test("max_main_messages is gone: fifteen updates reach an idle main agent and the reminder still fires after 250 silent tool calls", async () => {
  assert.equal("max_main_messages" in agent_session, false);
  assert.doesNotMatch(message_main_agent_tool.spec.description, /at most|per run/i);
  const update_rounds = 15;
  const silent_rounds = 11;
  let round = 0;
  scripts.set(
    "pf updates",
    async () => {
      round += 1;
      if (round <= update_rounds) {
        return calls(["message_main_agent", { text: `finding ${round}` }]);
      }
      if (round <= update_rounds + silent_rounds) {
        return calls(...Array.from({ length: agent_session.reminder_interval }, () => ["pf_probe", {}] as [string, Record<string, unknown>]));
      }
      return completed({ content: "final report" });
    },
  );
  const started = deploy_agent(request("pf updates", { chat_id: "pf-updates" }));
  await reported(started.run.run_id);
  const mine = updates.filter((update) => update.run_id === started.run.run_id);
  assert.equal(mine.length, update_rounds);
  assert.equal(mine.at(-1)?.text, `finding ${update_rounds}`);
  const sent = events.flatMap((event) => (event.run_id === started.run.run_id && event.type === "tool_end" && event.status === "done" && event.result_text.startsWith("Sent to the main agent") ? [event] : []));
  assert.equal(sent.length, update_rounds);
  const reminders = events.filter((event) => event.run_id === started.run.run_id && event.type === "notice" && event.notice === "update_reminder");
  assert.equal(reminders.length, silent_rounds);
  const last = reminders.at(-1);
  assert.equal(last?.type === "notice" ? last.round : -1, update_rounds + silent_rounds);
});

test("peer digests and a message loop never reach a waiting main agent as an alert; the reports wake it", async () => {
  const chat_id = "pf-wake";
  register_active(chat_id, "main-wake", () => undefined, model, "");
  const controller = new AbortController();
  const state = { woke: null as boolean | null };
  const third = deferred();
  const ids = { a: "", b: "" };
  scripts.set(
    "pf wake A",
    stepper([
      async () => calls(["message_peer", { to: ids.b, type: "info", about: "src/a.ts", summary: "m1", text: "m1 text" }]),
      async (messages) => {
        if (!has_note(messages, "m2 text")) {
          await wait_for(() => (live_run(a.run.run_id)?.inbox.length ?? 0) > 0);
          return completed({ content: "" });
        }
        await third.promise;
        return calls(["message_peer", { to: ids.b, type: "info", about: "src/a.ts", summary: "m3", text: "m3 text" }]);
      },
      async () => {
        if (peer_count(a.run.run_id) > 1) {
          return completed({ content: "A report" });
        }
        await third.promise;
        return calls(["message_peer", { to: ids.b, type: "info", about: "src/a.ts", summary: "m3", text: "m3 text" }]);
      },
      async () => completed({ content: "A report" }),
    ]),
  );
  scripts.set(
    "pf wake B",
    stepper([
      async (messages) => {
        if (!has_note(messages, "m1 text")) {
          await wait_for(() => (live_run(b.run.run_id)?.inbox.length ?? 0) > 0);
          return completed({ content: "" });
        }
        return calls(["message_peer", { to: ids.a, type: "info", about: "src/a.ts", summary: "m2", text: "m2 text" }]);
      },
      async () => {
        if (peer_count(b.run.run_id) === 0) {
          return calls(["message_peer", { to: ids.a, type: "info", about: "src/a.ts", summary: "m2", text: "m2 text" }]);
        }
        await wait_for(() => live_run(a.run.run_id) === null);
        return completed({ content: "B report" });
      },
      async () => {
        await wait_for(() => live_run(a.run.run_id) === null);
        return completed({ content: "B report" });
      },
    ]),
  );
  const a = deploy_agent(request("pf wake A", { chat_id, name: "Ping" }));
  const b = deploy_agent(request("pf wake B", { chat_id, name: "Pong" }));
  ids.a = label(a);
  ids.b = label(b);
  try {
    const waiting = wait_for_input(chat_id, 5000, controller.signal).then((value) => {
      state.woke = value;
    });
    await wait_for(() => peer_count(a.run.run_id) === 1 && peer_count(b.run.run_id) === 1);
    await sleep(60);
    assert.equal(state.woke, null);
    assert.equal(has_agent_notes(chat_id), false);
    third.resolve();
    await waiting;
    assert.equal(state.woke, true);
    await wait_for(() => live_run(a.run.run_id) === null);
    await wait_for(() => live_run(b.run.run_id) === null);
    const notes = take_agent_notes(chat_id);
    assert.equal(notes.filter((note) => note.kind === "notice" && note.notice === "agent_update").length, 0);
    assert.equal(notes.filter((note) => note.kind === "notice" && note.notice === "agent_report").length, 2);
    const digests = notes.flatMap((note) => (note.kind === "notice" && note.notice === "peer_digest" ? [note.text] : []));
    assert.deepEqual(
      digests.map((line) => /: info, about src\/a\.ts: '(m\d)'$/.exec(line)?.[1]),
      ["m1", "m2", "m3"],
    );
  } finally {
    controller.abort();
    unregister_active(chat_id, "main-wake");
    await stop_all(a, b);
  }
});

test("with an idle main agent a digest starts nothing and a message is delivered at once", async () => {
  const chat_id = "pf-idle";
  const a = deploy_agent(request("pf park", { chat_id, name: "Sender" }));
  const b = deploy_agent(request("pf park", { chat_id, name: "Receiver" }));
  await parked(a, b);
  try {
    const counts = () => [updates.length, reports.length];
    const before = counts();
    const queued = await send_peer(sender_of(a), info(label(b), "plain info"));
    assert.equal(queued.status, "done");
    flush_reports(chat_id);
    assert.deepEqual(counts(), before);
    assert.equal(has_agent_notes(chat_id), false);
    assert.equal(await wait_for_input(chat_id, 30, new AbortController().signal), false);
    const inbox = live_run(b.run.run_id)?.inbox ?? [];
    assert.deepEqual(
      inbox.map((entry) => (entry.from === "peer" ? entry.summary : entry.from)),
      ["plain info"],
    );
    const lines = take_agent_notes(chat_id).flatMap((note) => (note.kind === "notice" && note.notice === "peer_digest" ? [note.text] : []));
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? "", /: info, about src\/a\.ts: 'plain info'$/);
  } finally {
    await stop_all(a, b);
  }
});
