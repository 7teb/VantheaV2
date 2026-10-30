import type { ServerResponse } from "node:http";
import { serve_media } from "../media/protocol.ts";

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

export const send_media = async (target: string, method: string, response: ServerResponse, extra: Record<string, string>) => {
  const reply = await serve_media(new Request(target, { method }));
  const headers: Record<string, string> = { ...extra };
  reply.headers.forEach((value, name) => {
    headers[name] = value;
  });
  const body = method === "HEAD" || !reply.body ? null : Buffer.from(await reply.arrayBuffer());
  response.writeHead(reply.status, headers);
  response.end(body);
};
