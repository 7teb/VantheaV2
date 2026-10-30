import type { IncomingMessage, ServerResponse } from "node:http";
import { channel_kind, type InvokeName, type SendName } from "../../shared/ipc/index.ts";
import { remote_refused } from "../../shared/remote-policy.ts";
import { client_header, client_id_pattern, decode_wire, encode_wire, rpc_body_limit, type RpcReply } from "../../shared/remote-wire.ts";
import { note_client, remote_client_id } from "../ipc/clients.ts";
import { dispatch_invoke, dispatch_send } from "../ipc/handle.ts";
import { error_text, is_record } from "../storage/coerce.ts";

const max_args = 16;

export const send_json = (response: ServerResponse, status: number, reply: RpcReply, headers: Record<string, string>, close = false) => {
  const body = Buffer.from(encode_wire(reply));
  response.writeHead(status, {
    ...headers,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(body.length),
    "Cache-Control": "no-store",
    ...(close ? { Connection: "close" } : {}),
  });
  response.end(body);
};

const read_body = (request: IncomingMessage, limit: number): Promise<string | null> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    request.on("data", (chunk: Buffer) => {
      if (over) {
        return;
      }
      size += chunk.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!over) {
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    request.on("error", reject);
  });

const media_type = (value: string | undefined) => (value ?? "").split(";")[0].trim().toLowerCase();

const parse_request = (text: string): { channel: string; args: unknown[] } | string => {
  let parsed: unknown;
  try {
    parsed = decode_wire(text);
  } catch (error) {
    return `request body is not valid JSON: ${error_text(error)}`;
  }
  if (!is_record(parsed) || typeof parsed.channel !== "string" || !Array.isArray(parsed.args)) {
    return "request body must be {channel, args}";
  }
  if (parsed.args.length > max_args) {
    return `at most ${max_args} arguments are accepted`;
  }
  return { channel: parsed.channel, args: parsed.args };
};

export const handle_rpc = async (request: IncomingMessage, response: ServerResponse, session_id: string, host: string, headers: Record<string, string>) => {
  const fail = (status: number, error: string, close = false) => send_json(response, status, { ok: false, error }, headers, close);
  if (request.headers.origin !== `http://${host}`) {
    console.warn(`[remote] refused an rpc call with origin ${String(request.headers.origin).slice(0, 200)} from ${request.socket.remoteAddress}`);
    return fail(403, "origin not allowed");
  }
  if (media_type(request.headers["content-type"]) !== "application/json") {
    return fail(415, "content type must be application/json");
  }
  const page = request.headers[client_header];
  if (typeof page !== "string" || !client_id_pattern.test(page)) {
    return fail(400, `missing or invalid ${client_header} header`);
  }
  if (Number(request.headers["content-length"] ?? 0) > rpc_body_limit) {
    return fail(413, `request body is larger than ${rpc_body_limit} bytes`, true);
  }
  const text = await read_body(request, rpc_body_limit);
  if (text === null) {
    return fail(413, `request body is larger than ${rpc_body_limit} bytes`, true);
  }
  const parsed = parse_request(text);
  if (typeof parsed === "string") {
    return fail(400, parsed);
  }
  const { channel, args } = parsed;
  const kind = channel_kind(channel);
  if (kind === null || kind === "event") {
    return fail(404, `unknown channel ${channel.slice(0, 120)}`);
  }
  const client = remote_client_id(session_id, page);
  if (remote_refused.has(channel as InvokeName | SendName)) {
    console.warn(`[remote] refused ${channel} from ${client}`);
    return fail(403, `${channel} is not available on a remote client`);
  }
  note_client(client);
  try {
    if (kind === "invoke") {
      const result = await dispatch_invoke(client, channel as InvokeName, args);
      return send_json(response, 200, { ok: true, result }, headers);
    }
    dispatch_send(client, channel as SendName, args);
    return send_json(response, 200, { ok: true }, headers);
  } catch (error) {
    return fail(500, error_text(error));
  }
};
