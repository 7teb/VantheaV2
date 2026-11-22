import type { IncomingMessage, ServerResponse } from "node:http";
import { api_version, type ApiEvent } from "../../shared/api/contract.ts";
import { event_names } from "../../shared/api/routes.ts";
import type { EventPayload } from "../../shared/ipc/index.ts";
import { api_client } from "../ipc/clients.ts";
import type { EventTap } from "../ipc/handle.ts";
import { backlog_limit, create_ring, ping_interval_ms, resume_point, ring_limit } from "../remote/ring.ts";

type MappedName = keyof typeof event_names;

type Frame = { session_id: string | null; text: string };

type Stream = { session_id: string | null; response: ServerResponse };

type Settled = Extract<ApiEvent, { type: "run.settled" }>;

type AgentChat = (run_id: string) => string | null;

let agent_chat: AgentChat = () => null;

const session_of: { [K in MappedName]: (payload: EventPayload<K>) => string | null } = {
  "turn:event": (payload) => payload.chat_id,
  "chats:appended": (payload) => payload.chat_id,
  "chats:changed": (payload) => payload.id,
  "chats:removed": (payload) => payload.chat_id,
  "questions:changed": (payload) => payload.chat_id,
  "agent:event": (payload) => agent_chat(payload.run_id),
  "agents:changed": (payload) => payload.chat_id,
  "agents:approvals_changed": (payload) => payload.chat_id,
  "background:changed": (payload) => payload.chat_id,
  "chatgpt:changed": () => null,
  "claude:changed": () => null,
};

const ring = create_ring<Frame>(ring_limit);
const streams = new Set<Stream>();
let ping: NodeJS.Timeout | null = null;
let remove_tap: (() => void) | null = null;

const frame_text = (type: ApiEvent["type"], data: unknown, id: string | null) => `${id === null ? "" : `id: ${id}\n`}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

const wants = (stream: Stream, frame: Frame) => stream.session_id === null || stream.session_id === frame.session_id;

const check_backlog = (stream: Stream) => {
  if (stream.response.writableLength <= backlog_limit) {
    return;
  }
  console.warn(`[api] closing an event stream${stream.session_id ? ` of session ${stream.session_id}` : ""}, ${stream.response.writableLength} bytes are still waiting`);
  streams.delete(stream);
  stream.response.destroy();
};

const write = (stream: Stream, text: string) => {
  stream.response.write(text);
  check_backlog(stream);
};

const push = (type: ApiEvent["type"], data: unknown, session_id: string | null) => {
  const { value } = ring.push((seq) => {
    const text = frame_text(type, data, `${ring.boot}.${seq}`);
    return { value: { session_id, text }, size: Buffer.byteLength(text) };
  });
  for (const stream of [...streams]) {
    if (wants(stream, value)) {
      write(stream, value.text);
    }
  }
};

const forward: EventTap = (target, name, payload) => {
  if ((target !== null && target !== api_client) || !Object.hasOwn(event_names, name)) {
    return;
  }
  const mapped = name as MappedName;
  const extract = session_of[mapped] as (payload: unknown) => string | null;
  push(event_names[mapped], payload, extract(payload));
};

export const publish = (type: Settled["type"], data: Settled["data"], session_id: string): void => {
  push(type, data, session_id);
};

const last_event_id = (request: IncomingMessage, url: URL) => {
  const header = request.headers["last-event-id"];
  return (Array.isArray(header) ? header[0] : header) || url.searchParams.get("last") || "";
};

export const open_stream = (request: IncomingMessage, response: ServerResponse, url: URL): void => {
  const stream: Stream = { session_id: url.searchParams.get("session") || null, response };
  const resume = resume_point(last_event_id(request, url), ring.boot, ring.seq(), ring.oldest());
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });
  request.socket.setNoDelay(true);
  request.socket.setKeepAlive(true);
  const hello_seq = resume.kind === "replay" ? resume.after : ring.seq();
  response.write(frame_text("hello", { boot: ring.boot, api: api_version }, `${ring.boot}.${hello_seq}`));
  if (resume.kind === "resync") {
    response.write(frame_text("resync", null, null));
  }
  if (resume.kind === "replay") {
    for (const { value } of ring.after(resume.after)) {
      if (wants(stream, value)) {
        response.write(value.text);
      }
    }
  }
  streams.add(stream);
  response.on("close", () => streams.delete(stream));
  check_backlog(stream);
};

export const start_events = (add_event_tap: (tap: EventTap) => () => void, chat_of_agent_run: AgentChat): void => {
  ring.reset();
  agent_chat = chat_of_agent_run;
  remove_tap?.();
  remove_tap = add_event_tap(forward);
  if (ping) {
    clearInterval(ping);
  }
  ping = setInterval(() => {
    const text = frame_text("ping", null, null);
    for (const stream of [...streams]) {
      write(stream, text);
    }
  }, ping_interval_ms);
  ping.unref();
};

export const stop_events = (): void => {
  remove_tap?.();
  remove_tap = null;
  if (ping) {
    clearInterval(ping);
    ping = null;
  }
  const open = [...streams];
  streams.clear();
  for (const stream of open) {
    stream.response.end();
  }
};
