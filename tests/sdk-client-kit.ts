import http from "node:http";
import type { AddressInfo } from "node:net";
import type { AccountInfo, RunResult } from "../shared/api/contract.ts";
import type { ChatgptAccount } from "../shared/chatgpt.ts";
import type { BillingMode } from "../shared/settings.ts";
import { create_client } from "../sdk/client.ts";

type Seen = { method: string; path: string; query: Record<string, string>; headers: http.IncomingHttpHeaders; body: Buffer };

export type Reply = { status: number; body?: unknown; raw?: string };

type Stub = {
  seen: Seen[];
  replies: Map<string, Reply>;
  streams: http.ServerResponse[];
  on_request: (seen: Seen) => void;
  push: (type: string, data: unknown, id?: string) => void;
};

export const start_stub = async () => {
  const stub: Stub = {
    seen: [],
    replies: new Map(),
    streams: [],
    on_request: () => undefined,
    push: (type, data, id) => {
      for (const stream of stub.streams) {
        stream.write(`${id ? `id: ${id}\n` : ""}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    },
  };
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(chunk as Buffer);
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const seen: Seen = { method: request.method ?? "", path: url.pathname, query: Object.fromEntries(url.searchParams), headers: request.headers, body: Buffer.concat(chunks) };
    stub.seen.push(seen);
    if (url.pathname === "/v1/events") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`id: b.0\nevent: hello\ndata: ${JSON.stringify({ boot: "b", api: 1 })}\n\n`);
      stub.streams.push(response);
      response.on("close", () => stub.streams.splice(stub.streams.indexOf(response), 1));
      stub.on_request(seen);
      return;
    }
    const reply = stub.replies.get(`${seen.method} ${seen.path}`) ?? { status: 404, body: { error: { code: "not_found", message: `${seen.method} ${seen.path}` } } };
    if (reply.raw !== undefined) {
      response.writeHead(reply.status, { "content-type": "text/html" });
      response.end(reply.raw);
    } else if (reply.body === undefined) {
      response.writeHead(reply.status);
      response.end();
    } else {
      response.writeHead(reply.status, { "content-type": "application/json" });
      response.end(JSON.stringify(reply.body));
    }
    stub.on_request(seen);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base_url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = () => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { stub, client: create_client({ base_url, token: "tok" }), base_url, close };
};

export const json_body = (seen: Seen | undefined): unknown => (seen && seen.body.length ? JSON.parse(seen.body.toString("utf8")) : undefined);

export const result_of = (run_id: string, status: RunResult["status"]): RunResult => ({
  run_id,
  session_id: "s1",
  status,
  error: null,
  text: status === "running" ? "" : "final answer",
  messages: [],
  needs_input: { questions: [], approvals: [], plan_message_id: null },
  active: { turn: status === "running", agents: 0, workflows: 0, background: 0, queued: 0 },
  changed_files: [],
  usage: { prompt_tokens: 1, completion_tokens: 2, reasoning_tokens: 0, rounds: 1 },
  started_at: "2026-11-20T12:00:00.000Z",
  ended_at: status === "running" ? null : "2026-11-20T12:00:05.000Z",
});

export const account_info = (billing: BillingMode, patch: Partial<ChatgptAccount> = {}): AccountInfo => ({
  billing,
  chatgpt: { status: "signed_out", email: null, name: null, plan_enabled: false, notice_seen: false, error: null, ...patch },
});

export const turn_event = (message_id: string, body: Record<string, unknown>, seq: number) => ({ ...body, seq, at: 0, chat_id: "s1", message_id });
