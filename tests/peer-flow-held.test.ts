import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { live_run, live_runs } from "../electron/agents/live.ts";
import { send_peer } from "../electron/agents/peers.ts";
import { questions_asked_by } from "../electron/agents/questions.ts";
import { parse_index } from "../electron/agents/records.ts";
import { take_agent_notes } from "../electron/agents/reports.ts";
import { deploy_agent, shutdown_agents_sync } from "../electron/agents/runner.ts";
import { get_agent, init_agent_store } from "../electron/agents/store.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import { get_agent_status_tool } from "../electron/tools/agents/manage.ts";
import { continue_agent_tool } from "../electron/tools/agents/start.ts";
import { block_until_abort, completed, reports, request, root, scripts, start_runner, stop_runner, tools, wait_for, type Script } from "./agents-runner-harness.ts";
import { allowed_peer_tool, calls, is_peer_note, kept_peer, label, note_ids, notices, parked, peer_request, peer_views, reported, sender_of, stepper, stop_all, tool_context, view_of } from "./peer-flow-kit.ts";

before(start_runner);

after(stop_runner);

tools.push(allowed_peer_tool, get_agent_status_tool);

scripts.set("pf park", block_until_abort);

test("an answer to an asker that already finished is held, told to the main agent, and continue_agent delivers it in round 0 before the task", async () => {
  const ids = { a: "", b: "" };
  let second_run: ApiMessage[] = [];
  scripts.set(
    "pf held A",
    stepper([
      async () => calls(["message_peer", { to: ids.b, type: "question", about: "src/parser/tokens.ts", summary: "which token kinds exist", text: "Which TokenKind values exist?" }]),
      async () => completed({ content: "asked, finishing without the answer" }),
      async (messages) => {
        second_run = messages;
        return completed({ content: "used the answer" });
      },
    ]),
  );
  const answer_after_asker_ended = async (messages: ApiMessage[]) => {
    await reported(a.run.run_id);
    return calls(["message_peer", { to: ids.a, type: "answer", about: "src/parser/tokens.ts", summary: "three token kinds", text: "Ident, Number, Punct.", in_reply_to: note_ids(messages, "question")[0] ?? "" }]);
  };
  scripts.set(
    "pf held B",
    stepper([
      async (messages) => {
        if (note_ids(messages, "question").length) {
          return answer_after_asker_ended(messages);
        }
        await wait_for(() => (live_run(b.run.run_id)?.inbox.length ?? 0) > 0);
        return completed({ content: "" });
      },
      async (messages) => (peer_views(b.run.run_id).length ? completed({ content: "B done" }) : answer_after_asker_ended(messages)),
    ]),
  );
  const b = deploy_agent(request("pf held B", { chat_id: "pf-held", name: "Answerer" }));
  ids.b = label(b);
  const a = deploy_agent(request("pf held A", { chat_id: "pf-held", name: "Asker" }));
  ids.a = label(a);
  await reported(b.run.run_id);
  assert.equal(reports.find((report) => report.run_id === a.run.run_id)?.status, "completed");
  const [held_view] = peer_views(b.run.run_id);
  assert.equal(held_view?.view.outcome, "held");
  assert.match(held_view?.text ?? "", /^Asker#[0-9a-f]{8} has finished\. Your answer msg_[0-9a-f]{12} is kept and reaches it when the main agent continues it; the main agent was told\. Keep working\.$/);
  assert.equal(get_agent(a.agent.agent_id)?.held.length, 1);
  assert.equal(questions_asked_by(a.agent.agent_id).length, 0);
  const digest = take_agent_notes("pf-held").flatMap((note) => (note.kind === "notice" && note.notice === "peer_digest" ? [note.text] : []));
  assert.ok(digest.some((line) => line.includes(`${label(b)} → ${label(a)}: answer, about src/parser/tokens.ts: 'three token kinds'. ${label(a)} has finished, so the answer`)), digest.join("\n"));
  const result = await continue_agent_tool.execute(tool_context("pf-held", "main"), { agent_id: label(a), prompt: "pf use the answer" });
  assert.equal(result.status, "done", result.text);
  assert.match(result.text, / 1 kept peer message\(s\) arrive at the start of this run\./);
  const next_run = result.view?.kind === "agent" ? result.view.run_id : "";
  await reported(next_run);
  const note_at = second_run.findIndex(is_peer_note);
  const task_at = second_run.findIndex((message) => message.role === "user" && message.content === "pf use the answer");
  assert.ok(note_at >= 0 && note_at < task_at, `held note at ${note_at}, task at ${task_at}`);
  assert.match(String(second_run[note_at]?.content), /\ntype: answer\n[\s\S]*\nin_reply_to: msg_[0-9a-f]{12}\n\nIdent, Number, Punct\.$/);
  assert.deepEqual(
    notices(next_run, "peer_message").map((notice) => notice.round),
    [0],
  );
  assert.equal(get_agent(a.agent.agent_id)?.held.length, 0);
  const again = await continue_agent_tool.execute(tool_context("pf-held", "main"), { agent_id: label(a), prompt: "pf use the answer" });
  assert.doesNotMatch(again.text, /kept peer message/);
  await reported(again.view?.kind === "agent" ? again.view.run_id : "");
});

test("two agents that ask each other and answer each other both finish, without a loop alert and with no question left open", async () => {
  const ids = { a: "", b: "" };
  const runs = { a: "", b: "" };
  const answered = (self: "a" | "b") => peer_views(runs[self]).some((entry) => entry.view.type === "answer");
  const reply = (self: "a" | "b", other: "a" | "b", in_reply_to: string) =>
    calls(["message_peer", { to: ids[other], type: "answer", about: "shared.ts", summary: "no edits there", text: `No, I only read shared.ts. (${self})`, in_reply_to }]);
  const asker = (self: "a" | "b", other: "a" | "b"): Script =>
    stepper([
      async () => {
        await wait_for(() => runs.a !== "" && runs.b !== "");
        return calls(["message_peer", { to: ids[other], type: "question", about: "shared.ts", summary: `does ${other} edit shared.ts`, text: `Do you edit shared.ts? (${self})` }]);
      },
      async (messages) => {
        const question = note_ids(messages, "question")[0];
        if (!question) {
          await wait_for(() => (live_run(runs[self])?.inbox.length ?? 0) > 0);
          return completed({ content: "" });
        }
        return reply(self, other, question);
      },
      async (messages) => {
        const question = note_ids(messages, "question")[0];
        return question && !answered(self) ? reply(self, other, question) : completed({ content: `${self} done` });
      },
    ]);
  scripts.set("pf mutual A", asker("a", "b"));
  scripts.set("pf mutual B", asker("b", "a"));
  const a = deploy_agent(request("pf mutual A", { chat_id: "pf-mutual", name: "Left" }));
  const b = deploy_agent(request("pf mutual B", { chat_id: "pf-mutual", name: "Right" }));
  ids.a = label(a);
  ids.b = label(b);
  runs.a = a.run.run_id;
  runs.b = b.run.run_id;
  await reported(a.run.run_id);
  await reported(b.run.run_id);
  assert.equal(reports.find((report) => report.run_id === a.run.run_id)?.status, "completed");
  assert.equal(reports.find((report) => report.run_id === b.run.run_id)?.status, "completed");
  assert.equal(questions_asked_by(a.agent.agent_id).length + questions_asked_by(b.agent.agent_id).length, 0);
  for (const [run_id, agent_id] of [
    [a.run.run_id, a.agent.agent_id],
    [b.run.run_id, b.agent.agent_id],
  ] as const) {
    const answers = notices(run_id, "peer_message").filter((notice) => notice.text.includes("\ntype: answer\n")).length + (get_agent(agent_id)?.held.length ?? 0);
    assert.equal(answers, 1);
  }
});

test("the same short answer to two different questions answers both, and neither question stays open", async () => {
  const asker = deploy_agent(request("pf park", { chat_id: "pf-answers", name: "Asker" }));
  const ids = { asker: "" };
  const reply = (about: string, in_reply_to: string) => calls(["message_peer", { to: ids.asker, type: "answer", about, summary: "no", text: "No.", in_reply_to }]);
  scripts.set(
    "pf answers B",
    stepper([
      async (messages) => {
        await wait_for(() => note_ids(messages, "question").length + (live_run(answerer.run.run_id)?.inbox.length ?? 0) >= 2);
        return note_ids(messages, "question").length < 2 ? completed({ content: "" }) : reply("src/a.ts", note_ids(messages, "question")[0] ?? "");
      },
      async (messages) => {
        const [first, second] = note_ids(messages, "question");
        return peer_views(answerer.run.run_id).length ? reply("src/b.ts", second ?? "") : reply("src/a.ts", first ?? "");
      },
      async (messages) => (peer_views(answerer.run.run_id).length < 2 ? reply("src/b.ts", note_ids(messages, "question")[1] ?? "") : completed({ content: "answered both" })),
    ]),
  );
  const answerer = deploy_agent(request("pf answers B", { chat_id: "pf-answers", name: "Answerer" }));
  ids.asker = label(asker);
  await parked(asker);
  try {
    await send_peer(sender_of(asker), { ...peer_request(label(answerer), "question", "Do you edit src/a.ts?"), about: "src/a.ts" });
    await send_peer(sender_of(asker), { ...peer_request(label(answerer), "question", "Do you edit src/b.ts?"), about: "src/b.ts" });
    await reported(answerer.run.run_id);
    const outcomes = peer_views(answerer.run.run_id).map((entry) => entry.view.outcome);
    assert.deepEqual(outcomes, ["queued", "queued"], peer_views(answerer.run.run_id).at(-1)?.text);
    assert.deepEqual(
      questions_asked_by(asker.agent.agent_id).map((question) => question.about),
      [],
    );
  } finally {
    await stop_all(asker);
  }
});

test("get_agent_status from a sub-agent keeps the report or its report_from pointer inside the tool result cap when the task text is long", async () => {
  const long_task = `pf long task\n${"Check every parser branch and list the token kinds it accepts, with file and line. ".repeat(1500)}`;
  scripts.set(long_task, async () => completed({ content: "REPORT-START the parser accepts three token kinds REPORT-END" }));
  const done = deploy_agent(request(long_task, { chat_id: "pf-detail", name: "Longtask" }));
  await reported(done.run.run_id);
  let seen = "";
  scripts.set(
    "pf detail reader",
    stepper([
      async () => calls(["get_agent_status", { agent_id: label(done) }]),
      async (messages) => {
        seen = String(messages.findLast((message) => message.role === "tool")?.content ?? "");
        return completed({ content: "read it" });
      },
    ]),
  );
  const reader = deploy_agent(request("pf detail reader", { chat_id: "pf-detail", name: "Reader", profile: "explore" }));
  await reported(reader.run.run_id);
  assert.ok(seen.startsWith(`Agent ${label(done)}`), seen.slice(0, 200));
  assert.ok(seen.includes("REPORT-END") || /report_from \d+/.test(seen), `the tool result ends with: ${JSON.stringify(seen.slice(-160))}`);
});

test("a sub-agent reads a long finished report completely in pages through report_from", async () => {
  const report = Array.from({ length: 3000 }, (_, index) => `line ${String(index).padStart(5, "0")} of the long parser report with findings`).join("\n");
  scripts.set("pf long report", async () => completed({ content: report }));
  const done = deploy_agent(request("pf long report", { chat_id: "pf-paging", name: "Writer" }));
  await reported(done.run.run_id);
  const pages: string[] = [];
  const last_tool = (messages: ApiMessage[]) => String(messages.findLast((message) => message.role === "tool")?.content ?? "");
  const next_from = (text: string) => /and report_from (\d+) for the rest\.\]$/.exec(text)?.[1];
  const page_step = async (messages: ApiMessage[]) => {
    const text = last_tool(messages);
    pages.push(text);
    const from = next_from(text);
    return from ? calls(["get_agent_status", { agent_id: label(done), report_from: Number(from) }]) : completed({ content: "read all" });
  };
  scripts.set("pf pager", stepper([async () => calls(["get_agent_status", { agent_id: label(done) }]), page_step, page_step, page_step, page_step]));
  const pager = deploy_agent(request("pf pager", { chat_id: "pf-paging", name: "Pager", profile: "explore" }));
  await reported(pager.run.run_id);
  assert.ok(pages.length >= 2, `${pages.length} pages`);
  const bodies = pages.map((text, index) => {
    const marker = index === 0 ? "\nReport:\n" : /\nReport from character \d+:\n/.exec(text)?.[0] ?? "";
    const start = text.indexOf(marker) + marker.length;
    const end = text.lastIndexOf("\n\n[The report continues for ");
    return text.slice(start, end < 0 ? undefined : end);
  });
  assert.equal(bodies.join(""), report);
  assert.ok(pages.every((text) => !text.includes("[truncated:")));
});


test("closing the app holds an unread answer in the record, and it survives a store reload", async () => {
  const a = deploy_agent(request("pf park", { chat_id: "pf-close", name: "Asker" }));
  const b = deploy_agent(request("pf park", { chat_id: "pf-close", name: "Answerer" }));
  await parked(a, b);
  const result = await send_peer(sender_of(b), peer_request(label(a), "answer", "TokenKind has three values.", "msg_00000000aaaa"));
  assert.equal(view_of(result).outcome, "queued");
  shutdown_agents_sync();
  assert.equal(get_agent(a.agent.agent_id)?.held[0]?.text, "TokenKind has three values.");
  await wait_for(() => live_runs().length === 0);
  const stored = parse_index(JSON.parse(await fs.readFile(path.join(root, "agents", "index.json"), "utf8")), new Date().toISOString());
  assert.equal(kept_peer(stored.records.find((record) => record.agent_id === a.agent.agent_id)?.held[0])?.in_reply_to, "msg_00000000aaaa");
  await init_agent_store(path.join(root, "agents"));
  assert.equal(kept_peer(get_agent(a.agent.agent_id)?.held[0])?.message_id, view_of(result).message_id);
  assert.ok(
    take_agent_notes("pf-close").some((note) => note.kind === "notice" && note.notice === "peer_digest" && note.text.includes(`${label(a)} has finished, so the answer ${view_of(result).message_id} is kept`)),
  );
});

test("closing the app writes a running asker's open question into its stored report", async () => {
  const a = deploy_agent(request("pf park", { chat_id: "pf-close-question", name: "Asker" }));
  const b = deploy_agent(request("pf park", { chat_id: "pf-close-question", name: "Asked" }));
  await parked(a, b);
  const result = await send_peer(sender_of(a), peer_request(label(b), "question", "Who changes TokenKind?"));
  const message_id = view_of(result).message_id;
  shutdown_agents_sync();
  await wait_for(() => live_runs().length === 0);
  const report = get_agent(a.agent.agent_id)?.runs.at(-1)?.report ?? "";
  assert.ok(report.includes(`Open questions of ${label(a)}:`), report);
  assert.match(report, new RegExp(`to ${label(b)} about src/parser/tokens\\.ts since \\d\\d:\\d\\d \\(${message_id}\\), still without an answer\\.`));
});
