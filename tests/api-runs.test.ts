import assert from "node:assert/strict";
import http from "node:http";
import { Readable } from "node:stream";
import { test } from "node:test";
import { api_handlers } from "../electron/api/router.ts";
import { admit_run, forget_session_runs, run_result, tracked_run, wait_run } from "../electron/api/runs.ts";
import { assistant, context, end, fire, flush, idle, open, settled_events, state, turn_done, use_runs_kit, user } from "./api-runs-kit.ts";

use_runs_kit();

test("follow-up assistant messages join the open run, which settles when the chat goes idle", async () => {
  const started = await open("chat-1", "m1", [user("u-m1"), assistant("m1")]);
  assert.deepEqual(started, { run_id: "m1", user_message_id: "u-m1", message_id: "m1" });
  const chat = state.chats.get("chat-1");
  assert.ok(chat);
  end("chat-1", "m1", "done");
  chat.messages.push(user("note"), assistant("m2"));
  fire(null, "chats:appended", { chat_id: "chat-1", message: chat.messages.at(-2) });
  fire(null, "chats:appended", { chat_id: "chat-1", message: chat.messages.at(-1) });
  fire(null, "chats:appended", { chat_id: "chat-2", message: assistant("other") });
  const running = await run_result(context, "chat-1", "m1");
  assert.equal(running.status, "running");
  assert.deepEqual(running.messages.map((message) => message.id), ["m1", "m2"]);
  assert.equal(running.ended_at, null);
  end("chat-1", "m2", "failed");
  idle.get("chat-1")?.[0].done.resolve();
  await flush();
  const settled = await run_result(context, "chat-1", "m1");
  assert.equal(settled.status, "failed");
  assert.equal(settled.text, "answer m2");
  assert.deepEqual(settled.active, { turn: false, agents: 0, workflows: 0, background: 1, queued: 0 });
  assert.deepEqual(settled_events.map((event) => event.data), [{ session_id: "chat-1", run_id: "m1", status: "failed" }]);
});

test("the next admitted prompt settles the earlier run once and its messages do not join it", async () => {
  await open("chat-1", "m1", [user("u-m1"), assistant("m1")]);
  end("chat-1", "m1", "done");
  const earlier_idle = idle.get("chat-1")?.[0];
  const started = await admit_run(context, "chat-1", async () => {
    const chat = state.chats.get("chat-1");
    assert.ok(chat);
    chat.messages.push(user("u-m3"), assistant("m3"));
    fire(null, "chats:appended", { chat_id: "chat-1", message: chat.messages.at(-1) });
    return { user_message_id: "u-m3", message_id: "m3" };
  });
  assert.equal(started?.run_id, "m3");
  assert.equal(earlier_idle?.signal.aborted, true);
  assert.deepEqual((await run_result(context, "chat-1", "m1")).messages.map((message) => message.id), ["m1"]);
  assert.equal((await run_result(context, "chat-1", "m1")).status, "done");
  assert.equal((await run_result(context, "chat-1", "m3")).status, "running");
  earlier_idle?.done.resolve();
  await flush();
  assert.deepEqual(settled_events.map((event) => event.data), [{ session_id: "chat-1", run_id: "m1", status: "done" }]);
});

test("run results list main and agent approvals with unified ids and refuse unknown runs", async () => {
  await open("chat-1", "m1", [user("u-m1"), assistant("m1")]);
  const result = await run_result(context, "chat-1", "m1");
  assert.deepEqual(
    result.needs_input.approvals.map((entry) => [entry.approval_id, entry.source, entry.agent_id, entry.run_id, entry.call_id]),
    [
      ["m:c2_1", "main", null, null, "c2_1"],
      ["a:agent_1:run_1:c1_0", "agent", "agent_1", "run_1", "c1_0"],
    ],
  );
  await assert.rejects(run_result(context, "chat-1", "nope"), /run nope not found/);
  await assert.rejects(run_result(context, "chat-2", "m1"), /run m1 not found in session chat-2/);
});

test("wait_run returns on settle for idle, after the first turn for turn, and rejects on abort", async () => {
  await open("chat-1", "m1", [user("u-m1"), assistant("m1")]);
  const controller = new AbortController();
  const aborted = wait_run(context, "chat-1", "m1", "idle", controller.signal);
  controller.abort(new Error("client gone"));
  await assert.rejects(aborted, /client gone/);
  let turn_returned = false;
  const turn = wait_run(context, "chat-1", "m1", "turn", new AbortController().signal).then((result) => {
    turn_returned = true;
    return result;
  });
  const settle = wait_run(context, "chat-1", "m1", "idle", new AbortController().signal);
  await flush();
  assert.equal(turn_returned, false);
  end("chat-1", "m1", "done");
  await flush();
  assert.equal(turn_returned, false);
  turn_done.resolve();
  assert.equal((await turn).status, "running");
  idle.get("chat-1")?.[0].done.resolve();
  assert.equal((await settle).status, "done");
  assert.equal((await wait_run(context, "chat-1", "m1", "turn", new AbortController().signal)).status, "done");
});

test("removed sessions drop settled runs at once and open runs when they settle", async () => {
  await open("chat-1", "m1", [user("u-m1"), assistant("m1")]);
  end("chat-1", "m1", "done");
  idle.get("chat-1")?.[0].done.resolve();
  await flush();
  await open("chat-1", "m2", [user("u-m2"), assistant("m2")]);
  state.chats.delete("chat-1");
  forget_session_runs("chat-1");
  assert.equal(tracked_run("m1"), false);
  assert.equal(tracked_run("m2"), true);
  end("chat-1", "m2", "stopped");
  idle.get("chat-1")?.[1].done.resolve();
  await flush();
  assert.equal(tracked_run("m2"), false);
  assert.deepEqual(settled_events.map((event) => (event.type === "run.settled" ? event.data.status : null)), ["done", "stopped"]);
});

const json_request = (body: unknown) =>
  Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { headers: { "content-type": "application/json" } }) as unknown as http.IncomingMessage;

const reply = (body: unknown) =>
  api_handlers["questions.reply"]({
    context,
    request: json_request(body),
    response: new http.ServerResponse(json_request(body)),
    url: new URL("http://127.0.0.1/v1/sessions/chat-1/questions"),
    params: { id: "chat-1" },
  });

test("an answer that starts a turn opens a new run with the pinned options, a steered answer does not", async () => {
  await open("chat-1", "m1", [user("u-m1"), assistant("m1", "done")]);
  end("chat-1", "m1", "done");
  const started = await reply({ answers: [{ id: "q1", answer: "yes" }] });
  assert.deepEqual(started, { kind: "json", status: 202, body: { run_id: "m9", user_message_id: "u9", message_id: "m9" } });
  assert.deepEqual(state.pins.get("chat-1"), { mode: "auto", approvals: "reject", choice: { model: "vendor/a", effort: "low", pro: false } });
  assert.deepEqual((await run_result(context, "chat-1", "m1")).messages.map((message) => message.id), ["m1"]);
  assert.deepEqual((await run_result(context, "chat-1", "m9")).messages.map((message) => message.id), ["m9"]);
  await flush();
  assert.deepEqual(settled_events.map((event) => event.data), [{ session_id: "chat-1", run_id: "m1", status: "done" }]);
  const steered = await reply({ answers: [{ id: "q2", answer: "no" }] });
  assert.deepEqual(steered, { kind: "empty", status: 204 });
  assert.equal(tracked_run("m9"), true);
  await assert.rejects(reply({}), /needs answers or dismiss/);
  await assert.rejects(reply({ answers: [{ id: "q", answer: "a" }, { id: "q", answer: "b" }] }), /must not repeat/);
});
