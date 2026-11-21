import type { ApiErrorCode } from "../shared/api/contract.ts";
import { api_routes, route_path, type RouteId } from "../shared/api/routes.ts";

export type ClientConfig = { base_url: string; token: string };

export type RouteParams<Id extends RouteId> = Parameters<typeof route_path<Id>>[1];

type RequestOptions = {
  body?: unknown;
  raw?: { bytes: Uint8Array; headers: Record<string, string> };
  query?: Record<string, string | undefined>;
  signal?: AbortSignal;
};

export class VantheaxError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = "VantheaxError";
    this.status = status;
    this.code = code;
  }
}

const error_codes: Record<ApiErrorCode, true> = {
  unauthorized: true,
  forbidden_origin: true,
  bad_host: true,
  invalid_request: true,
  unknown_model: true,
  not_found: true,
  session_busy: true,
  payload_too_large: true,
  shutting_down: true,
  internal: true,
};

const methods = new Map<string, string>(api_routes.map((route) => [route.id, route.method]));

export const error_text = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const api_error_of = (value: unknown): { code: ApiErrorCode; message: string } | null => {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return null;
  }
  const body = value.error;
  if (typeof body !== "object" || body === null || !("code" in body) || !("message" in body)) {
    return null;
  }
  const { code, message } = body;
  if (typeof code !== "string" || typeof message !== "string" || !Object.hasOwn(error_codes, code)) {
    return null;
  }
  return { code: code as ApiErrorCode, message };
};

const response_error = async (response: Response): Promise<VantheaxError> => {
  const text = await response.text();
  const summary = `HTTP ${response.status} ${response.statusText}${text.trim() ? `: ${text.trim()}` : ""}`;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return new VantheaxError(response.status, "internal", `${summary} (the body is not JSON: ${error_text(error)})`);
  }
  const parsed = api_error_of(value);
  return parsed ? new VantheaxError(response.status, parsed.code, parsed.message) : new VantheaxError(response.status, "internal", summary);
};

const route_url = <Id extends RouteId>(config: ClientConfig, id: Id, params: RouteParams<Id>, query: RequestOptions["query"]): string => {
  const url = new URL(`${config.base_url.replace(/\/+$/, "")}${route_path(id, params)}`);
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(name, value);
    }
  }
  return url.toString();
};

export const send = async <Id extends RouteId>(config: ClientConfig, id: Id, params: RouteParams<Id>, options: RequestOptions = {}): Promise<Response> => {
  const headers: Record<string, string> = { authorization: `Bearer ${config.token}` };
  let body: Uint8Array | string | undefined;
  if (options.raw) {
    Object.assign(headers, options.raw.headers);
    body = options.raw.bytes;
  } else if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(route_url(config, id, params, options.query), {
    method: methods.get(id),
    headers,
    body,
    signal: options.signal,
  });
  if (!response.ok) {
    throw await response_error(response);
  }
  return response;
};

export const request = async <T, Id extends RouteId = RouteId>(
  config: ClientConfig,
  id: Id,
  params: RouteParams<Id>,
  options: RequestOptions = {},
): Promise<T> => {
  const response = await send(config, id, params, options);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
};
