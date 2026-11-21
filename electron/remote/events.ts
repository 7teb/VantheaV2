import type { IncomingMessage, ServerResponse } from "node:http";
import type { EventName } from "../../shared/ipc/index.ts";
import { remote_hidden_events } from "../../shared/remote-policy.ts";
import { client_id_pattern, encode_wire, stream_control } from "../../shared/remote-wire.ts";
import { client_gone, client_session, known_clients, remote_client_id, set_client_connected, type ClientId } from "../ipc/clients.ts";
import { add_event_tap } from "../ipc/handle.ts";
import { backlog_limit, create_ring, ping_interval_ms, resume_point, ring_limit } from "./ring.ts";

type Stream = { client: ClientId; response: ServerResponse };

type Frame = { target: ClientId | null; text: string };

const streams = new Set<Stream>();
const ring = create_ring<Frame>(ring_limit);
let ping: NodeJS.Timeout | null = null;
let remove_tap: (() => void) | null = null;
let on_count: (count: number) => void = () => undefined;

const frame_text = (name: string, payload?: unknown) => `data: ${encode_wire(payload === undefined ? { n: name } : { n: name, p: payload })}\n\n`;

export const connected_count = (): number => new Set([...streams].map((stream) => stream.client)).size;

const has_stream = (client: ClientId) => [...streams].some((stream) => stream.client === client);

const drop = (stream: Stream) => {
  if (!streams.delete(stream)) {
    return;
  }
  if (!has_stream(stream.client)) {
    set_client_connected(stream.client, false);
  }
  on_count(connected_count());
};

const check_backlog = (stream: Stream) => {
  if (stream.response.writableLength <= backlog_limit) {
    return;
  }
  console.warn(`[remote] closing the event stream of ${stream.client}, ${stream.response.writableLength} bytes are still waiting`);
  drop(stream);
  stream.response.destroy();
};

const write = (stream: Stream, text: string) => {
  stream.response.write(text);
  check_backlog(stream);
};

const forward = (target: ClientId | null, name: EventName, payload: unknown) => {
  if (remote_hidden_events.has(name)) {
    return;
  }
  const { value } = ring.push((seq) => {
    const text = `id: ${ring.boot}.${seq}\n${frame_text(name, payload)}`;
    return { value: { target, text }, size: Buffer.byteLength(text) };
  });
  for (const stream of [...streams]) {
    if (target === null || stream.client === target) {
      write(stream, value.text);
    }
  }
};

const last_event_id = (request: IncomingMessage, url: URL) => {
  const header = request.headers["last-event-id"];
  return (Array.isArray(header) ? header[0] : header) || url.searchParams.get("last") || "";
};

const forget_idle_pages = (client: ClientId, session_id: string) => {
  for (const other of known_clients()) {
    if (other !== client && client_session(other) === session_id && !has_stream(other)) {
      client_gone(other);
    }
  }
};

export const open_stream = (request: IncomingMessage, response: ServerResponse, session_id: string, url: URL, headers: Record<string, string>) => {
  const page = url.searchParams.get("client") ?? "";
  if (!client_id_pattern.test(page)) {
    response.writeHead(400, headers);
    response.end();
    return;
  }
  const stream_headers = { ...headers, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" };
  if (request.method === "HEAD") {
    response.writeHead(200, stream_headers);
    response.end();
    return;
  }
  const client = remote_client_id(session_id, page);
  const resume = resume_point(last_event_id(request, url), ring.boot, ring.seq(), ring.oldest());
  response.writeHead(200, stream_headers);
  request.socket.setNoDelay(true);
  request.socket.setKeepAlive(true);
  const hello_seq = resume.kind === "replay" ? resume.after : ring.seq();
  response.write(`id: ${ring.boot}.${hello_seq}\n${frame_text(stream_control.hello, { boot: ring.boot })}`);
  if (resume.kind === "resync") {
    response.write(frame_text(stream_control.resync));
  }
  if (resume.kind === "replay") {
    for (const { value } of ring.after(resume.after)) {
      if (value.target === null || value.target === client) {
        response.write(value.text);
      }
    }
  }
  if (!known_clients().includes(client)) {
    forget_idle_pages(client, session_id);
  }
  const stream: Stream = { client, response };
  streams.add(stream);
  set_client_connected(client, true);
  on_count(connected_count());
  response.on("close", () => drop(stream));
  check_backlog(stream);
};

export const revoke_streams = (): void => {
  for (const stream of [...streams]) {
    streams.delete(stream);
    stream.response.end();
  }
  for (const client of known_clients()) {
    client_gone(client);
  }
  on_count(0);
};

export const start_hub = (notify: (count: number) => void): void => {
  ring.reset();
  on_count = notify;
  ping = setInterval(() => {
    const text = frame_text(stream_control.ping);
    for (const stream of [...streams]) {
      write(stream, text);
    }
  }, ping_interval_ms);
  ping.unref();
  remove_tap?.();
  remove_tap = add_event_tap(forward);
};

export const stop_hub = (): void => {
  remove_tap?.();
  remove_tap = null;
  if (ping) {
    clearInterval(ping);
    ping = null;
  }
  on_count = () => undefined;
  revoke_streams();
  ring.reset();
};
