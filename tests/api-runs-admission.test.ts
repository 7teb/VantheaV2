import assert from "node:assert/strict";
import { test } from "node:test";
import { RequestError } from "../electron/api/body.ts";
import { admit_run, run_result, stop_runs, wait_run } from "../electron/api/runs.ts";
import { assistant, chat_of, context, end, fire, flush, idle, open, settled_events, state, turn_done, use_runs_kit, user } from "./api-runs-kit.ts";

use_runs_kit();

const append = (chat_id: string, message: ReturnType<typeof assistant>) => {
  const chat = state.chats.get(chat_id);
  assert.ok(chat);
  chat.messages.push(message);
  fire(null, "chats:appended", { chat_id, message });
};

test("an end that arrives inside the admission window still ends the first turn of the new run", async () => {
  state.chats.set("chat-1", chat_of("chat-1", [user("u-m5")]));
  const started = await admit_run(context, "chat-1", async () => {
    append("chat-1", assistant("m5"));
    end("chat-1", "m5", "failed");
    return { user_message_id: "u-m5", message_id: "m5" };
  });
  assert.equal(started?.run_id, "m5");
  turn_done.resolve();
  const result = await wait_run(context, "chat-1", "m5", "turn", new AbortController().signal);
  assert.deepEqual(result.messages.map((message) => [message.id, message.status]), [["m5", "failed"]]);
});

test("assistant messages appended during a failed admission join the open run", async () => {
  await open("chat-1", "m1", [user("u-m1"), assistant("m1", "done")]);
  end("chat-1", "m1", "done");
  await assert.rejects(
    admit_run(context, "chat-1", async () => {
      append("chat-1", assistant("m6"));
      throw new Error("chat chat-1 already has a running turn");
    }),
    /already has a running turn/,
  );
  assert.deepEqual((await run_result(context, "chat-1", "m1")).messages.map((message) => message.id), ["m1", "m6"]);
  end("chat-1", "m6", "blocked");
  idle.get("chat-1")?.[0].done.resolve();
  await flush();
  assert.deepEqual(settled_events.map((event) => event.data), [{ session_id: "chat-1", run_id: "m1", status: "blocked" }]);
});

test("run.settled takes its status from the stored chat when no end event was seen", async () => {
  await open("chat-1", "m1", [user("u-m1"), assistant("m1")]);
  const chat = state.chats.get("chat-1");
  assert.ok(chat);
  chat.messages = [user("u-m1"), assistant("m1", "stopped")];
  idle.get("chat-1")?.[0].done.resolve();
  await flush();
  assert.deepEqual(settled_events.map((event) => event.data), [{ session_id: "chat-1", run_id: "m1", status: "stopped" }]);
  assert.equal((await run_result(context, "chat-1", "m1")).status, "stopped");
});

test("a run reads as settled once the chat is idle, before the idle wait has fired", async () => {
  await open("chat-1", "m1", [user("u-m1"), assistant("m1")]);
  end("chat-1", "m1", "done");
  assert.equal((await run_result(context, "chat-1", "m1")).status, "running");
  state.idle_now = true;
  const result = await run_result(context, "chat-1", "m1");
  assert.equal(result.status, "done");
  assert.equal(result.ended_at, "2026-11-20T00:01:00.000Z");
});

test("stopping the runs publishes run.settled for open runs and ends held waits with shutting_down", async () => {
  await open("chat-1", "m1", [user("u-m1"), assistant("m1")]);
  await open("chat-2", "m2", [user("u-m2"), assistant("m2")]);
  end("chat-1", "m1", "interrupted");
  end("chat-2", "m2", "interrupted");
  const held = wait_run(context, "chat-2", "m2", "turn", new AbortController().signal);
  const settled = wait_run(context, "chat-1", "m1", "idle", new AbortController().signal);
  await stop_runs(context);
  await assert.rejects(held, (error: unknown) => error instanceof RequestError && error.status === 503 && error.code === "shutting_down");
  assert.equal((await settled).status, "interrupted");
  await flush();
  assert.deepEqual(settled_events.map((event) => event.data), [
    { session_id: "chat-1", run_id: "m1", status: "interrupted" },
    { session_id: "chat-2", run_id: "m2", status: "interrupted" },
  ]);
});
