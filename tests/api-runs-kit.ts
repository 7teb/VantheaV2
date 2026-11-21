import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach } from "node:test";
import { open_stream, start_events, stop_events } from "../electron/api/events.ts";
import type { ApiContext } from "../electron/api/router.ts";
import { admit_run, start_runs, stop_runs } from "../electron/api/runs.ts";
import type { EventTap } from "../electron/ipc/handle.ts";
import type { RunOptions } from "../electron/turn/run-options.ts";
import { parse_sse, to_api_event } from "../sdk/events.ts";
import type { ApiEvent } from "../shared/api/contract.ts";
import type { ApprovalRequest } from "../shared/approval.ts";
import type { AssistantMessage, Chat, Message, TurnStatus } from "../shared/chat.ts";

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

export const assistant = (id: string, status: TurnStatus = "streaming"): AssistantMessage => ({
  id,
  role: "assistant",
  model: "vendor/a",
  effort: "low",
  mode: "auto",
  plan: false,
  created_at: "2026-11-20T00:00:00.000Z",
  ended_at: status === "streaming" ? null : "2026-11-20T00:01:00.000Z",
  status,
  steps: [{ id: `${id}:text`, round: 1, kind: "text", text: `answer ${id}` }],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

export const user = (id: string): Message => ({ id, role: "user", text: "hi", attachments: [], origin: "user", created_at: "2026-11-20T00:00:00.000Z" });

const command: ApprovalRequest = { kind: "command", command: "rm x", cwd: "D:\\proj", background: false, review: null, grant_prefix: null };

const taps = new Set<EventTap>();
export const idle = new Map<string, { done: ReturnType<typeof deferred>; signal: AbortSignal }[]>();
export const state = {
  chats: new Map<string, Chat>(),
  active: new Set<string>(),
  active_message: null as string | null,
  pins: new Map<string, RunOptions>(),
  calls: [] as string[],
  idle_now: false,
};
export let turn_done = deferred();

export const fire: EventTap = (target, name, payload) => {
  for (const tap of [...taps]) {
    tap(target, name, payload);
  }
};

export const chat_of = (id: string, messages: Message[]): Chat => ({
  id,
  title: "",
  project_path: "D:\\proj",
  workspace: "",
  pinned: false,
  created_at: "",
  updated_at: "",
  message_count: messages.length,
  streaming: false,
  summary: null,
  messages,
  questions: {},
});

const invoke = async (name: string, ...args: unknown[]): Promise<unknown> => {
  state.calls.push(name);
  if (name === "chats:get") {
    return state.chats.get(String(args[0])) ?? null;
  }
  if (name === "agents:approvals") {
    return { chat_id: args[0], approvals: [{ agent_id: "agent_1", run_id: "run_1", call_id: "c1_0", name: "helper", request: command }] };
  }
  if (name === "questions:answer") {
    if (state.active.has("chat-1")) {
      return undefined;
    }
    const chat = state.chats.get("chat-1");
    assert.ok(chat);
    chat.messages.push(user("u9"));
    fire(null, "chats:appended", { chat_id: "chat-1", message: chat.messages.at(-1) });
    chat.messages.push(assistant("m9"));
    fire(null, "chats:appended", { chat_id: "chat-1", message: chat.messages.at(-1) });
    state.active.add("chat-1");
    state.active_message = "m9";
    return undefined;
  }
  throw new Error(`unexpected ${name}`);
};

export const context: ApiContext = {
  token: "k".repeat(40),
  port: 1,
  invoke: invoke as ApiContext["invoke"],
  add_event_tap: (tap) => {
    taps.add(tap);
    return () => {
      taps.delete(tap);
    };
  },
  session_meta: (id) => state.chats.get(id) ?? null,
  is_active: (id) => state.active.has(id),
  active_message: () => state.active_message,
  turn_settled: () => turn_done.promise,
  chat_activity: () => ({ turn: false, agents: 0, workflows: 0, background: 1, queued: 0 }),
  chat_idle: () => state.idle_now,
  when_idle: (chat_id, signal) => {
    const done = deferred();
    idle.set(chat_id, [...(idle.get(chat_id) ?? []), { done, signal }]);
    return new Promise<void>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
      done.promise.then(resolve);
    });
  },
  pending_approvals: (chat_id) => [
    { key: chat_id, call_id: "c2_1", request: command },
    { key: "agent:run_1", call_id: "c1_0", request: command },
  ],
  uploaded: () => [],
  protected_dirs: [],
  run_options: (id) => state.pins.get(id) ?? null,
  set_run_options: (id, options) => {
    state.pins.set(id, options);
  },
  forget_run_options: (id) => {
    state.pins.delete(id);
  },
  settings: () => ({ model: "vendor/a", effort: "low" }),
  model_catalog: async () => ({ models: [], side: { title: "", overseer: "", vision: "", reasoning_status: "", transcription: "", git_text: "" }, side_models: [], image_models: [] }),
  version: "1",
  headless: true,
  quit: () => {},
};

let server: http.Server;
let base = "";
let stream_controller = new AbortController();
export let settled_events: ApiEvent[] = [];

const read_settled = async (signal: AbortSignal) => {
  const response = await fetch(`${base}/v1/events`, { signal });
  assert.ok(response.body);
  try {
    for await (const frame of parse_sse(response.body)) {
      const event = to_api_event(frame);
      if (event?.type === "run.settled") {
        settled_events.push(event);
      }
    }
  } catch (error) {
    if (!signal.aborted) {
      throw error;
    }
  }
};

export const flush = async () => {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

export const use_runs_kit = (): void => {
  before(async () => {
    server = http.createServer((request, response) => open_stream(request, response, new URL(request.url ?? "/", "http://127.0.0.1")));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await stop_runs(context);
    stop_events();
    stream_controller.abort();
    taps.clear();
    idle.clear();
    state.chats.clear();
    state.active.clear();
    state.active_message = null;
    state.pins.clear();
    state.calls.length = 0;
    state.idle_now = false;
    settled_events = [];
    turn_done = deferred();
    start_events(context.add_event_tap, () => null);
    start_runs(context);
    stream_controller = new AbortController();
    void read_settled(stream_controller.signal);
    await flush();
  });

  after(async () => {
    await stop_runs(context);
    stop_events();
    stream_controller.abort();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
};

export const open = (session_id: string, message_id: string, messages: Message[]) => {
  state.chats.set(session_id, chat_of(session_id, messages));
  return admit_run(context, session_id, async () => ({ user_message_id: `u-${message_id}`, message_id }));
};

export const end = (chat_id: string, message_id: string, status: TurnStatus) => {
  const chat = state.chats.get(chat_id);
  if (chat) {
    chat.messages = chat.messages.map((message) => (message.id === message_id ? assistant(message_id, status) : message));
  }
  fire(null, "turn:event", { type: "end", status, error: null, seq: 9, at: 1, chat_id, message_id });
};
