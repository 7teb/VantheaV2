import { agent_option_keys, type HookDraft, type ScriptRef } from "./protocol.ts";

export class RefusedCall extends Error {}

type Payload = Record<string, unknown>;

const is_object = (value: unknown): value is Payload => typeof value === "object" && value !== null && !Array.isArray(value);

const has = (payload: Payload, key: string): boolean => Object.hasOwn(payload, key);

const text_field = (payload: Payload, key: string, where: string): string => {
  const value = payload[key];
  if (typeof value !== "string") {
    throw new RefusedCall(`${where}: ${key} must be a string, the sandbox got ${value === null ? "null" : typeof value}`);
  }
  return value;
};

const filled_field = (payload: Payload, key: string, where: string): string => {
  const value = text_field(payload, key, where);
  if (!value.trim()) {
    throw new RefusedCall(`${where}: ${key} must not be empty`);
  }
  return value;
};

const read_opts = (value: unknown): Payload => {
  if (!is_object(value)) {
    throw new RefusedCall("agent(): opts must be an object");
  }
  const unknown = Object.keys(value).filter((key) => !agent_option_keys.includes(key));
  if (unknown.length) {
    throw new RefusedCall(`agent(): unknown option ${unknown.join(", ")}`);
  }
  for (const key of ["label", "model", "effort"]) {
    if (has(value, key)) {
      text_field(value, key, "agent() opts");
    }
  }
  if (has(value, "phase") && value.phase !== null) {
    filled_field(value, "phase", "agent() opts");
  }
  if (has(value, "schema") && !is_object(value.schema)) {
    throw new RefusedCall("agent(): opts.schema must be a JSON Schema object");
  }
  if (has(value, "role") && typeof value.role !== "string" && !is_object(value.role)) {
    throw new RefusedCall("agent(): opts.role must be a role name or a role object");
  }
  if (has(value, "isolation") && value.isolation !== "worktree") {
    throw new RefusedCall("agent(): opts.isolation can only be 'worktree'");
  }
  return value;
};

const read_ref = (value: unknown): ScriptRef => {
  if (!is_object(value) || Object.keys(value).length !== 1) {
    throw new RefusedCall("workflow(): ref must be { name } or { script_path }");
  }
  if (has(value, "name")) {
    return { name: filled_field(value, "name", "workflow() ref") };
  }
  return { script_path: filled_field(value, "script_path", "workflow() ref") };
};

const read_value_json = (payload: Payload): string => {
  const text = text_field(payload, "value_json", "return");
  try {
    JSON.parse(text);
  } catch (error) {
    throw new RefusedCall(`return: value_json is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  return text;
};

const read_payload = (payload_text: string, kind: string): Payload => {
  let payload: unknown;
  try {
    payload = JSON.parse(payload_text);
  } catch (error) {
    throw new RefusedCall(`the ${kind} call is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!is_object(payload)) {
    throw new RefusedCall(`the ${kind} call must be an object`);
  }
  return payload;
};

export const parse_hook_call = (kind: string, payload_text: string): HookDraft => {
  const payload = read_payload(payload_text, kind);
  switch (kind) {
    case "agent":
      return { kind, prompt: filled_field(payload, "prompt", "agent()"), opts: read_opts(payload.opts) };
    case "workflow":
      if (typeof payload.has_args !== "boolean") {
        throw new RefusedCall("workflow(): has_args must be a boolean");
      }
      return { kind, ref: read_ref(payload.ref), args: has(payload, "args") ? payload.args : null, has_args: payload.has_args };
    case "phase":
      return { kind, title: filled_field(payload, "title", "phase()") };
    case "log":
      return { kind, text: text_field(payload, "text", "log()") };
    case "caught":
      return { kind, where: text_field(payload, "where", "caught"), text: text_field(payload, "text", "caught") };
    case "done":
      return { kind, value_json: read_value_json(payload) };
    case "failed":
      return { kind, message: text_field(payload, "message", "failed") };
    default:
      throw new RefusedCall(`the sandbox has no ${kind} call`);
  }
};
