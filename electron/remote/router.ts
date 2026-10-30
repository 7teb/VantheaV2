import type { IncomingMessage, ServerResponse } from "node:http";
import { events_path, media_path, pair_path, rpc_path } from "../../shared/remote-wire.ts";
import { visual_frame_file } from "../../shared/visual-doc.ts";
import { pair, session_of } from "./auth.ts";
import { open_stream } from "./events.ts";
import { media_target, send_media } from "./media.ts";
import { missing_bundle_page, page_csp, unpaired_page } from "./pages.ts";
import { handle_rpc, send_json } from "./rpc.ts";
import { read_static, static_root } from "./static.ts";

const security_headers: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const html_headers: Record<string, string> = { "Content-Security-Policy": "frame-ancestors 'self'", "X-Frame-Options": "SAMEORIGIN" };

let allowed_hosts = new Set<string>();

export const set_allowed_hosts = (hosts: string[]): void => {
  allowed_hosts = new Set(hosts);
};

const send_empty = (response: ServerResponse, status: number, headers: Record<string, string> = {}) => {
  response.writeHead(status, { ...security_headers, ...headers });
  response.end();
};

const send_page = (response: ServerResponse, method: string, status: number, html: string) => {
  const body = Buffer.from(html);
  response.writeHead(status, {
    ...security_headers,
    ...html_headers,
    "Content-Security-Policy": page_csp,
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": String(body.length),
    "Cache-Control": "no-store",
  });
  response.end(method === "HEAD" ? undefined : body);
};

const send_static = async (response: ServerResponse, method: string, pathname: string) => {
  const file = await read_static(static_root(), pathname);
  if (file.status === 503) {
    return send_page(response, method, 503, missing_bundle_page());
  }
  if (file.status === 404) {
    return send_empty(response, 404);
  }
  response.writeHead(200, {
    ...security_headers,
    ...(file.html ? html_headers : {}),
    "Content-Type": file.type,
    "Content-Length": String(file.body.length),
    "Cache-Control": file.cache,
  });
  response.end(method === "HEAD" ? undefined : file.body);
};

const send_pairing = (request: IncomingMessage, response: ServerResponse, method: string, url: URL) => {
  const cookie = pair(url.searchParams.get("t") ?? "");
  if (!cookie) {
    console.warn(`[remote] pairing with a wrong token from ${request.socket.remoteAddress}`);
    return send_page(response, method, 401, unpaired_page());
  }
  send_empty(response, 303, { Location: "/", "Set-Cookie": cookie, "Cache-Control": "no-store" });
};

const is_api = (pathname: string) => pathname === rpc_path || pathname === events_path || pathname === media_path || pathname.startsWith(`${media_path}/`);

const handle_request = async (request: IncomingMessage, response: ServerResponse) => {
  const host = request.headers.host ?? "";
  if (!allowed_hosts.has(host)) {
    return send_empty(response, 421);
  }
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${host}`);
  const { pathname } = url;
  const site = request.headers["sec-fetch-site"];
  if (is_api(pathname) && site !== undefined && site !== "same-origin") {
    console.warn(`[remote] refused ${method} ${pathname} with Sec-Fetch-Site ${site} from ${request.socket.remoteAddress}`);
    return send_empty(response, 403);
  }
  const method_allowed = pathname === rpc_path ? method === "POST" : method === "GET" || method === "HEAD";
  if (!method_allowed) {
    return send_empty(response, 405, { Allow: pathname === rpc_path ? "POST" : "GET, HEAD" });
  }
  if (pathname === pair_path) {
    return send_pairing(request, response, method, url);
  }
  if (pathname === `/${visual_frame_file}`) {
    return send_static(response, method, pathname);
  }
  const session_id = session_of(request);
  if (pathname === rpc_path) {
    return session_id ? handle_rpc(request, response, session_id, host, security_headers) : send_json(response, 401, { ok: false, error: "not paired" }, security_headers);
  }
  if (pathname === events_path) {
    return session_id ? open_stream(request, response, session_id, url, security_headers) : send_empty(response, 401);
  }
  if (is_api(pathname)) {
    const target = media_target(pathname, media_path);
    if (!session_id) {
      return send_empty(response, 401);
    }
    return target ? send_media(target, method, response, security_headers) : send_empty(response, 404);
  }
  if (!session_id) {
    return send_page(response, method, 401, unpaired_page());
  }
  return send_static(response, method, pathname);
};

export const route = (request: IncomingMessage, response: ServerResponse): void => {
  handle_request(request, response).catch((error) => {
    console.error(`[remote] ${request.method} ${String(request.url).split("?")[0].slice(0, 200)} failed:`, error);
    if (response.headersSent) {
      response.destroy();
      return;
    }
    send_empty(response, 500);
  });
};
