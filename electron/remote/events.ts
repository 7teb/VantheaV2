import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { EventName } from "../../shared/ipc/index.ts";
import { remote_hidden_events } from "../../shared/remote-policy.ts";
import { client_id_pattern, encode_wire, stream_control } from "../../shared/remote-wire.ts";
import { client_gone, client_session, known_clients, remote_client_id, set_client_connected, type ClientId } from "../ipc/clients.ts";
import { set_event_tap } from "../ipc/handle.ts";

type Stream = { client: ClientId; response: ServerResponse };

type Frame = { seq: number; target: ClientId | null; text: string; size: number };

export type Resume = { kind: "fresh" } | { kind: "replay"; after: number } | { kind: "resync" };

const ring_limit = 16 * 1024 * 1024;

const backlog_limit = 8 * 1024 * 1024;

const ping_interval_ms = 20_000;

const event_id = /^([0-9a-f]+)\.(\d+)$/;

const streams = new Set<Stream>();
let frames: Frame[] = [];
let head = 0;
let ring_bytes = 0;
let boot = "";
let seq = 0;
let ping: NodeJS.Timeout | null = null;
let on_count: (count: number) => void = () => undefined;

const frame_text = (name: string, payload?: unknown) => `data: ${encode_wire(payload === undefined ? { n: name } : { n: name, p: payload })}\n\n`;

const oldest_seq = () => (head < frames.length ? frames[head].seq : seq + 1);

const remember = (frame: Frame) => {
  frames.push(frame);
  ring_bytes += frame.size;
  while (ring_bytes > ring_limit && head < frames.length) {
    ring_bytes -= frames[head].size;
    head += 1;
  }
  if (head > 4096 && head * 2 > frames.length) {
    frames = frames.slice(head);
    head = 0;
  }
};

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
  seq += 1;
  const text = `id: ${boot}.${seq}\n${frame_text(name, payload)}`;
  remember({ seq, target, text, size: Buffer.byteLength(text) });
  for (const stream of [...streams]) {
    if (target === null || stream.client === target) {
      write(stream, text);
    }
  }
};

export const resume_point = (last: string, current_boot: string, current_seq: number, oldest: number): Resume => {
  if (!last) {
    return { kind: "fresh" };
  }
  const match = event_id.exec(last);
  const after = match ? Number(match[2]) : -1;
  if (!match || match[1] !== current_boot || after > current_seq || after < oldest - 1) {
    return { kind: "resync" };
  }
  return { kind: "replay", after };
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
  const resume = resume_point(last_event_id(request, url), boot, seq, oldest_seq());
  response.writeHead(200, stream_headers);
  request.socket.setNoDelay(true);
  request.socket.setKeepAlive(true);
  const hello_seq = resume.kind === "replay" ? resume.after : seq;
  response.write(`id: ${boot}.${hello_seq}\n${frame_text(stream_control.hello, { boot })}`);
  if (resume.kind === "resync") {
    response.write(frame_text(stream_control.resync));
  }
  if (resume.kind === "replay") {
    for (const frame of frames.slice(head)) {
      if (frame.seq > resume.after && (frame.target === null || frame.target === client)) {
        response.write(frame.text);
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
  boot = randomBytes(6).toString("hex");
  seq = 0;
  frames = [];
  head = 0;
  ring_bytes = 0;
  on_count = notify;
  ping = setInterval(() => {
    const text = frame_text(stream_control.ping);
    for (const stream of [...streams]) {
      write(stream, text);
    }
  }, ping_interval_ms);
  ping.unref();
  set_event_tap(forward);
};

export const stop_hub = (): void => {
  set_event_tap(null);
  if (ping) {
    clearInterval(ping);
    ping = null;
  }
  on_count = () => undefined;
  revoke_streams();
  frames = [];
  head = 0;
  ring_bytes = 0;
};
