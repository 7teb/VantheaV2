import type { IncomingMessage, ServerResponse } from "node:http";
import { serve_media } from "../media/protocol.ts";
import { still_paired } from "./auth.ts";

const buckets = new Set(["attachment", "image", "favicon"]);

export const media_target = (pathname: string, prefix: string): string | null => {
  const rest = pathname.slice(prefix.length + 1);
  const slash = rest.indexOf("/");
  const bucket = rest.slice(0, slash);
  if (!pathname.startsWith(`${prefix}/`) || slash <= 0 || !buckets.has(bucket) || slash === rest.length - 1) {
    return null;
  }
  return `vx-media://${bucket}/${rest.slice(slash + 1)}`;
};

export const send_media = async (request: IncomingMessage, session_id: string, target: string, response: ServerResponse, extra: Record<string, string>) => {
  const method = request.method ?? "GET";
  const reply = await serve_media(new Request(target, { method }));
  const headers: Record<string, string> = { ...extra };
  reply.headers.forEach((value, name) => {
    headers[name] = value;
  });
  const body = method === "HEAD" || !reply.body ? null : Buffer.from(await reply.arrayBuffer());
  if (!still_paired(request, session_id)) {
    response.writeHead(401, extra);
    response.end();
    return;
  }

  response.writeHead(reply.status, headers);
  response.end(body);
};
