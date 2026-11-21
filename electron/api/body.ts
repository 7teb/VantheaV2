import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiError, ApiErrorCode } from "../../shared/api/contract.ts";
import { error_text, is_record } from "../storage/coerce.ts";

export class RequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.code = code;
  }
}

export type Reply = { kind: "json"; status: number; body: unknown } | { kind: "empty"; status: number } | { kind: "stream" };

export const json_reply = (body: unknown, status = 200): Reply => ({ kind: "json", status, body });

export const empty_reply = (status: number): Reply => ({ kind: "empty", status });

export const stream_reply: Reply = { kind: "stream" };

export const json_limit = 1024 * 1024;

export const invalid = (message: string): RequestError => new RequestError(400, "invalid_request", message);

const too_large = (limit: number) => new RequestError(413, "payload_too_large", `the request body is larger than ${limit} bytes`);

const media_type = (value: string | undefined) => (value ?? "").split(";")[0].trim().toLowerCase();

const base_headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export const read_raw = (request: IncomingMessage, limit: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    if (Number(request.headers["content-length"] ?? 0) > limit) {
      reject(too_large(limit));
      return;
    }
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
        reject(too_large(limit));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!over) {
        resolve(Buffer.concat(chunks));
      }
    });
    request.on("error", reject);
  });

export const read_json = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  if (media_type(request.headers["content-type"]) !== "application/json") {
    throw invalid("the content type must be application/json");
  }
  const text = (await read_raw(request, json_limit)).toString("utf8");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw invalid(`the request body is not valid JSON: ${error_text(error)}`);
  }
  if (!is_record(value)) {
    throw invalid("the request body must be a JSON object");
  }
  return value;
};

export const required_text = (raw: Record<string, unknown>, name: string, max: number, min = 1): string => {
  const value = raw[name];
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw invalid(`${name} must be a string of ${min} to ${max} characters`);
  }
  return value;
};

export const optional_text = (raw: Record<string, unknown>, name: string, max: number): string | undefined =>
  raw[name] === undefined ? undefined : required_text(raw, name, max, 0);

export const optional_choice = <T extends string>(raw: Record<string, unknown>, name: string, allowed: readonly T[]): T | undefined => {
  const value = raw[name];
  if (value === undefined) {
    return undefined;
  }
  const choice = allowed.find((entry) => entry === value);
  if (!choice) {
    throw invalid(`${name} must be one of ${allowed.join(", ")}`);
  }
  return choice;
};

export const required_flag = (raw: Record<string, unknown>, name: string): boolean => {
  const value = raw[name];
  if (typeof value !== "boolean") {
    throw invalid(`${name} must be true or false`);
  }
  return value;
};

export const optional_flag = (raw: Record<string, unknown>, name: string): boolean | undefined => (raw[name] === undefined ? undefined : required_flag(raw, name));

export const optional_list = (raw: Record<string, unknown>, name: string, items: number, length: number): string[] | undefined => {
  const value = raw[name];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > items || !value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= length)) {
    throw invalid(`${name} must be a list of at most ${items} non-empty strings of at most ${length} characters`);
  }
  if (new Set(value).size !== value.length) {
    throw invalid(`${name} must not repeat an entry`);
  }
  return value;
};

export const send_json = (response: ServerResponse, status: number, value: unknown, close = false): void => {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    ...base_headers,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(body.length),
    ...(close ? { Connection: "close" } : {}),
  });
  response.end(body);
};

export const send_empty = (response: ServerResponse, status: number): void => {
  response.writeHead(status, base_headers);
  response.end();
};

export const send_error = (response: ServerResponse, status: number, code: ApiErrorCode, message: string, close = false): void => {
  const body: ApiError = { error: { code, message } };
  send_json(response, status, body, close);
};
