import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChatActivity } from "../../shared/api/contract.ts";
import { api_routes, type RouteId } from "../../shared/api/routes.ts";
import type { Attachment, ChatMeta } from "../../shared/chat.ts";
import type { InvokeArgs, InvokeName, InvokeResult } from "../../shared/ipc/index.ts";
import type { ModelCatalog } from "../../shared/models.ts";
import type { EventTap } from "../ipc/handle.ts";
import type { PendingApproval } from "../permissions/approvals.ts";
import { error_text } from "../storage/coerce.ts";
import type { RunOptions } from "../turn/run-options.ts";
import { check_request } from "./auth.ts";
import { RequestError, send_empty, send_error, send_json, type Reply } from "./body.ts";
import { account_routes } from "./routes-account.ts";
import { input_routes } from "./routes-input.ts";
import { misc_routes } from "./routes-misc.ts";
import { session_routes } from "./routes-sessions.ts";
import { turn_routes } from "./routes-turn.ts";

type ApiInvoke = <K extends InvokeName>(name: K, ...args: InvokeArgs<K>) => Promise<InvokeResult<K>>;

export type ApiContext = {
  token: string;
  port: number;
  invoke: ApiInvoke;
  add_event_tap: (tap: EventTap) => () => void;
  session_meta: (chat_id: string) => ChatMeta | null;
  is_active: (chat_id: string) => boolean;
  active_message: (chat_id: string) => string | null;
  turn_settled: (chat_id: string) => Promise<void>;
  ended_turn_settled: (chat_id: string) => Promise<void>;
  chat_activity: (chat_id: string) => ChatActivity;
  chat_idle: (chat_id: string) => boolean;
  when_idle: (chat_id: string, signal: AbortSignal) => Promise<void>;
  pending_approvals: (chat_id: string) => PendingApproval[];
  uploaded: (ids: string[]) => Attachment[];
  protected_dirs: readonly string[];
  run_options: (chat_id: string) => RunOptions | null;
  set_run_options: (chat_id: string, options: RunOptions) => void;
  forget_run_options: (chat_id: string) => void;
  settings: () => { model: string; effort: string };
  model_catalog: () => Promise<ModelCatalog>;
  version: string;
  headless: boolean;
  quit: () => void;
};

type ApiCall = { context: ApiContext; request: IncomingMessage; response: ServerResponse; url: URL; params: Record<string, string> };

export type Handler = (call: ApiCall) => Promise<Reply>;

export const api_handlers = { ...session_routes, ...turn_routes, ...input_routes, ...misc_routes, ...account_routes } satisfies Record<RouteId, Handler>;

export const check_handlers = (table: Readonly<Record<string, Handler | undefined>>): void => {
  const ids = new Set<string>(api_routes.map((entry) => entry.id));
  const missing = [...ids].filter((id) => typeof table[id] !== "function");
  const unrouted = Object.keys(table).filter((id) => !ids.has(id));
  if (missing.length || unrouted.length) {
    throw new Error(`the API handler table does not match api_routes: no handler for [${missing.join(", ")}], no route for [${unrouted.join(", ")}]`);
  }
};

const matchers = api_routes.map((entry) => ({ id: entry.id, method: entry.method, segments: entry.path.split("/") }));

const decode_segment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch (error) {
    throw new RequestError(400, "invalid_request", `the path segment ${segment.slice(0, 200)} is not valid URI encoding: ${error_text(error)}`);
  }
};

const match_segments = (segments: string[], parts: string[]): Record<string, string> | null => {
  const params: Record<string, string> = {};
  for (const [index, segment] of segments.entries()) {
    const part = parts[index];
    if (!segment.startsWith(":")) {
      if (segment !== part) {
        return null;
      }
      continue;
    }
    if (!part) {
      return null;
    }
    params[segment.slice(1)] = decode_segment(part);
  }
  return params;
};

export const match = (method: string, pathname: string): { id: RouteId; params: Record<string, string> } | null => {
  const parts = pathname.split("/");
  for (const matcher of matchers) {
    if (matcher.method !== method || matcher.segments.length !== parts.length) {
      continue;
    }
    const params = match_segments(matcher.segments, parts);
    if (params) {
      return { id: matcher.id, params };
    }
  }
  return null;
};

const write_reply = (response: ServerResponse, reply: Reply) => {
  if (reply.kind === "json") {
    send_json(response, reply.status, reply.body);
    return;
  }
  if (reply.kind === "empty") {
    send_empty(response, reply.status);
  }
};

const fail = (response: ServerResponse, label: string, error: unknown) => {
  if (response.destroyed) {
    console.warn(`[api] ${label} ended after the client closed the connection: ${error_text(error)}`);
    return;
  }
  if (response.headersSent) {
    console.error(`[api] ${label} failed after its response started:`, error);
    response.destroy();
    return;
  }
  if (error instanceof RequestError) {
    send_error(response, error.status, error.code, error.message, error.status === 413);
    return;
  }
  console.error(`[api] ${label} failed:`, error);
  send_error(response, 500, "internal", error_text(error));
};

const handle_request = async (context: ApiContext, request: IncomingMessage, response: ServerResponse): Promise<void> => {
  const refusal = check_request(request.headers, context);
  if (refusal) {
    send_error(response, refusal.status, refusal.code, refusal.message);
    return;
  }
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${context.port}`);
  const found = match(method, url.pathname);
  if (!found) {
    send_error(response, 404, "not_found", `no API route for ${method} ${url.pathname.slice(0, 200)}`);
    return;
  }
  try {
    write_reply(response, await api_handlers[found.id]({ context, request, response, url, params: found.params }));
  } catch (error) {
    fail(response, `route ${found.id}`, error);
  }
};

export const route = (context: ApiContext, request: IncomingMessage, response: ServerResponse): void => {
  handle_request(context, request, response).catch((error: unknown) => fail(response, `${request.method} ${String(request.url).split("?")[0].slice(0, 200)}`, error));
};
