import { attachment_limits, dictation_limit_bytes } from "./ipc/media.ts";

export const rpc_path = "/rpc";

export const events_path = "/events";

export const media_path = "/media";

export const pair_path = "/pair";

export const client_header = "x-vx-client";

export const client_id_pattern = /^[A-Za-z0-9_-]{16,64}$/;

export const rpc_body_limit = Math.ceil((Math.max(2 * attachment_limits.image_bytes, dictation_limit_bytes) * 4) / 3) + 1024 * 1024;

export type RpcRequest = { channel: string; args: unknown[] };

export type RpcReply = { ok: true; result?: unknown } | { ok: false; error: string };

export type StreamFrame = { n: string; p?: unknown };

export const stream_control = { hello: "vx:hello", ping: "vx:ping", resync: "vx:resync" } as const;

const base64_chunk = 3 * 8192;

const to_base64 = (bytes: Uint8Array) => {
  let text = "";
  for (let start = 0; start < bytes.length; start += base64_chunk) {
    text += btoa(String.fromCharCode(...bytes.subarray(start, start + base64_chunk)));
  }
  return text;
};

const from_base64 = (text: string) => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const is_record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array);

function replace_wire(this: unknown, key: string, value: unknown): unknown {
  const raw = (this as Record<string, unknown>)[key];
  if (raw instanceof Uint8Array) {
    return { $b: to_base64(raw) };
  }
  if (!is_record(value) || !Object.keys(value).some((name) => name.startsWith("$"))) {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([name, field]) => [name.startsWith("$") ? `$${name}` : name, field]));
}

const revive_wire = (_key: string, value: unknown): unknown => {
  if (!is_record(value)) {
    return value;
  }
  const names = Object.keys(value);
  if (names.length === 1 && names[0] === "$b" && typeof value.$b === "string") {
    return from_base64(value.$b);
  }
  if (!names.some((name) => name.startsWith("$"))) {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([name, field]) => [name.startsWith("$") ? name.slice(1) : name, field]));
};

export const encode_wire = (value: unknown): string => JSON.stringify(value, replace_wire) ?? "null";

export const decode_wire = (text: string): unknown => JSON.parse(text, revive_wire);
