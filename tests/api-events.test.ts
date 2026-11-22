import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { open_stream, publish, start_events, stop_events } from "../electron/api/events.ts";
import type { EventTap } from "../electron/ipc/handle.ts";
import { parse_sse, to_api_event } from "../sdk/events.ts";
import type { ApiEvent } from "../shared/api/contract.ts";

let server: http.Server;
let base = "";
let tap: EventTap | null = null;
const controllers = new Set<AbortController>();
const agent_chats = new Map([["run_1", "chat-1"]]);
const chat_of_agent_run = (run_id: string) => agent_chats.get(run_id) ?? null;

before(async () => {
  server = http.createServer((request, response) => open_stream(request, response, new URL(request.url ?? "/", "http://127.0.0.1")));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  start_events((next) => {
    tap = next;
    return () => {
      tap = null;
    };
  }, chat_of_agent_run);
});

after(async () => {
  stop_events();
  for (const controller of controllers) {
    controller.abort();
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const fire: EventTap = (target, name, payload) => {
  assert.ok(tap, "the event tap is installed");
  tap(target, name, payload);
};

const open = async (query = "", headers: Record<string, string> = {}) => {
  const controller = new AbortController();
  controllers.add(controller);
  const response = await fetch(`${base}/v1/events${query}`, { headers, signal: controller.signal });
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.ok(response.body);
  const frames = parse_sse(response.body)[Symbol.asyncIterator]();
  const next = async (): Promise<ApiEvent> => {
    const item = await frames.next();
    if (item.done) {
      throw new Error("the event stream ended");
    }
    const event = to_api_event(item.value);
    assert.ok(event, `known event type ${item.value.event}`);
    return event;
  };
  return { next, frames, close: () => controller.abort() };
};

const turn_event = (chat_id: string, delta: string) => ({ type: "text", round: 1, delta, seq: 1, at: 1, chat_id, message_id: "m1" });

test("a stream opens with hello and gets mapped IPC events with their payload", async () => {
  const stream = await open();
  const hello = await stream.next();
  assert.equal(hello.type, "hello");
  assert.deepEqual(hello.data, { boot: hello.id?.split(".")[0], api: 1 });
  fire(null, "settings:changed", { secret: "x" });
  fire("window", "turn:event", turn_event("chat-1", "only for the window"));
  fire("remote:abc.def", "turn:event", turn_event("chat-1", "only for a remote page"));
  fire(null, "turn:event", turn_event("chat-1", "hi"));
  fire("api", "chats:removed", { chat_id: "chat-1" });
  const first = await stream.next();
  assert.equal(first.type, "turn.event");
  assert.deepEqual(first.data, turn_event("chat-1", "hi"));
  const second = await stream.next();
  assert.deepEqual([second.type, second.data], ["session.deleted", { chat_id: "chat-1" }]);
  stream.close();
});

test("the session filter passes only events of that chat, agent events count for the chat of their run, and events without a chat id only reach unfiltered streams", async () => {
  const filtered = await open("?session=chat-1");
  const all = await open();
  await filtered.next();
  await all.next();
  fire(null, "agent:event", { type: "text", round: 1, delta: "agent", seq: 1, at: 1, agent_id: "agent_1", run_id: "run_1" });
  fire(null, "agent:event", { type: "text", round: 1, delta: "gone", seq: 1, at: 1, agent_id: "agent_2", run_id: "run_2" });
  fire(null, "turn:event", turn_event("chat-2", "other chat"));
  fire(null, "chats:changed", { id: "chat-2", streaming: false });
  fire(null, "background:changed", { id: "bg1", chat_id: "chat-1", status: "running" });
  fire(null, "chats:changed", { id: "chat-1", streaming: false });
  publish("run.settled", { session_id: "chat-1", run_id: "m1", status: "done" }, "chat-1");
  assert.deepEqual(
    [await filtered.next(), await filtered.next(), await filtered.next(), await filtered.next()].map((event) => event.type),
    ["agent.event", "background.changed", "session.updated", "run.settled"],
  );
  const types = [];
  for (let index = 0; index < 7; index += 1) {
    types.push((await all.next()).type);
  }
  assert.deepEqual(types, ["agent.event", "agent.event", "turn.event", "session.updated", "background.changed", "session.updated", "run.settled"]);
  filtered.close();
  all.close();
});

test("a ChatGPT account change reaches unfiltered streams as account.changed and never a session stream", async () => {
  const filtered = await open("?session=chat-1");
  const all = await open();
  await filtered.next();
  await all.next();
  const account = { status: "signed_in", email: "smoke@example.invalid", name: null, plan_enabled: true, notice_seen: false, error: null };
  fire("window", "chatgpt:changed", { ...account, status: "signing_in" });
  fire(null, "chatgpt:changed", account);
  fire("api", "chatgpt:changed", { ...account, status: "signed_out" });
  fire(null, "chats:changed", { id: "chat-1", streaming: false });
  const first = await all.next();
  const second = await all.next();
  assert.deepEqual([first.type, first.data], ["account.changed", account]);
  assert.deepEqual([second.type, second.type === "account.changed" ? second.data.status : null], ["account.changed", "signed_out"]);
  assert.equal((await all.next()).type, "session.updated");
  assert.equal((await filtered.next()).type, "session.updated");
  filtered.close();
  all.close();
});

test("a Claude Code login change reaches unfiltered streams as claude.changed and never a session stream", async () => {
  const filtered = await open("?session=chat-1");
  const all = await open();
  await filtered.next();
  await all.next();
  const account = { status: "signed_in", email: "smoke@example.invalid", subscription: "max", auth_method: "claude.ai", login_command: "& 'C:/x/claude.exe' auth login --claudeai", detail: "" };
  fire("window", "claude:changed", { ...account, status: "signed_out" });
  fire(null, "claude:changed", account);
  fire(null, "chats:changed", { id: "chat-1", streaming: false });
  const first = await all.next();
  assert.deepEqual([first.type, first.data], ["claude.changed", account]);
  assert.equal((await all.next()).type, "session.updated");
  assert.equal((await filtered.next()).type, "session.updated");
  filtered.close();
  all.close();
});

test("a stream resumed with last replays the frames after it, filtered like a live stream", async () => {
  const first = await open("?session=chat-1");
  await first.next();
  fire(null, "turn:event", turn_event("chat-1", "one"));
  const one = await first.next();
  first.close();
  fire(null, "turn:event", turn_event("chat-1", "two"));
  fire(null, "turn:event", turn_event("chat-2", "elsewhere"));
  fire(null, "turn:event", turn_event("chat-1", "three"));
  assert.ok(one.id);
  for (const resumed of [await open(`?session=chat-1&last=${one.id}`), await open("?session=chat-1", { "last-event-id": one.id })]) {
    const hello = await resumed.next();
    assert.deepEqual([hello.type, hello.id], ["hello", one.id]);
    const two = await resumed.next();
    const three = await resumed.next();
    assert.deepEqual(
      [two, three].map((event) => (event.type === "turn.event" && event.data.type === "text" ? event.data.delta : null)),
      ["two", "three"],
    );
    resumed.close();
  }
});

test("a last id from another boot or beyond the ring gets a resync after hello", async () => {
  const live = await open();
  const hello = await live.next();
  live.close();
  const boot = hello.id?.split(".")[0];
  for (const last of ["0badc0ffee00.3", `${boot}.999999`, "not-an-id"]) {
    const stream = await open(`?last=${encodeURIComponent(last)}`);
    const opened = await stream.next();
    assert.equal(opened.type, "hello");
    assert.notEqual(opened.id, last);
    const resync = await stream.next();
    assert.deepEqual([resync.type, resync.id, resync.data], ["resync", null, null]);
    stream.close();
  }
});

test("restarting the events hub starts a new boot, and stopping it ends open streams", async () => {
  const before_restart = await open();
  const first = await before_restart.next();
  before_restart.close();
  stop_events();
  assert.equal(tap, null);
  start_events((next) => {
    tap = next;
    return () => {
      tap = null;
    };
  }, chat_of_agent_run);
  const stream = await open(`?last=${first.id}`);
  const hello = await stream.next();
  assert.notEqual(hello.id?.split(".")[0], first.id?.split(".")[0]);
  assert.equal((await stream.next()).type, "resync");
  stop_events();
  assert.equal((await stream.frames.next()).done, true);
});
