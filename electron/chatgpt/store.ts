import { randomUUID } from "node:crypto";
import type { AccountModel } from "../../shared/chatgpt.ts";
import { error_text, is_record } from "../storage/coerce.ts";
import { keep_corrupt, read_json, write_json } from "../storage/json-file.ts";

export type StoredTokens = {
  access_token: string;
  refresh_token: string;
  id_token: string;
  token_type: string;
  scopes: string[];
  expires_at: number;
  earliest_refresh_at: number | null;
  saved_at: number;
};

export type StoredAccount = {
  issuer: string;
  subject: string;
  client_id: string;
  email: string | null;
  name: string | null;
  expired: boolean;
  tokens: StoredTokens | null;
};

export type SessionRecord = { account: StoredAccount | null; pending_client_id: string | null };

export type PlainState = { version: 1; host_id: string; notice_seen: boolean; models: AccountModel[] | null };

export type SessionSecret = { available: () => boolean; read: () => string; write: (plain: string) => Promise<void> };

const empty_session: SessionRecord = { account: null, pending_client_id: null };

const host_id_pattern = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const unreadable = (field: string): never => {
  throw new Error(`the field ${field} is invalid`);
};

const text = (value: unknown, field: string): string => (typeof value === "string" && value !== "" ? value : unreadable(field));

const optional_text = (value: unknown, field: string): string | null => (value === null ? null : text(value, field));

const finite = (value: unknown, field: string): number => (typeof value === "number" && Number.isFinite(value) ? value : unreadable(field));

const flag = (value: unknown, field: string): boolean => (typeof value === "boolean" ? value : unreadable(field));

const record = (value: unknown, field: string): Record<string, unknown> => (is_record(value) ? value : unreadable(field));

const parse_tokens = (value: unknown): StoredTokens | null => {
  if (value === null) {
    return null;
  }
  const raw = record(value, "tokens");
  const scopes: string[] = Array.isArray(raw.scopes) && raw.scopes.every((entry) => typeof entry === "string") ? raw.scopes : unreadable("tokens.scopes");
  return {
    access_token: text(raw.access_token, "tokens.access_token"),
    refresh_token: text(raw.refresh_token, "tokens.refresh_token"),
    id_token: text(raw.id_token, "tokens.id_token"),
    token_type: text(raw.token_type, "tokens.token_type"),
    scopes,
    expires_at: finite(raw.expires_at, "tokens.expires_at"),
    earliest_refresh_at: raw.earliest_refresh_at === null ? null : finite(raw.earliest_refresh_at, "tokens.earliest_refresh_at"),
    saved_at: finite(raw.saved_at, "tokens.saved_at"),
  };
};

const parse_account = (value: unknown): StoredAccount | null => {
  if (value === null) {
    return null;
  }
  const raw = record(value, "account");
  return {
    issuer: text(raw.issuer, "account.issuer"),
    subject: text(raw.subject, "account.subject"),
    client_id: text(raw.client_id, "account.client_id"),
    email: optional_text(raw.email, "account.email"),
    name: optional_text(raw.name, "account.name"),
    expired: flag(raw.expired, "account.expired"),
    tokens: parse_tokens(raw.tokens),
  };
};

export const read_session = (secret: SessionSecret): SessionRecord => {
  let plain: string;
  try {
    plain = secret.read();
  } catch (error) {
    console.error("[chatgpt] the stored ChatGPT session could not be decrypted, treating it as signed out:", error_text(error));
    return empty_session;
  }
  if (plain === "") {
    return empty_session;
  }
  try {
    const raw = record(JSON.parse(plain), "record");
    return { account: parse_account(raw.account), pending_client_id: optional_text(raw.pending_client_id, "pending_client_id") };
  } catch (error) {
    console.error("[chatgpt] the stored ChatGPT session is unreadable, treating it as signed out:", error instanceof SyntaxError ? "not valid JSON" : error_text(error));
    return empty_session;
  }
};

export const write_session = (secret: SessionSecret, session: SessionRecord): Promise<void> => secret.write(JSON.stringify(session));

export const parse_account_model = (value: unknown): AccountModel | null => {
  if (!is_record(value) || typeof value.slug !== "string" || value.slug === "" || typeof value.display_name !== "string") {
    return null;
  }
  const window = value.context_window;
  return { slug: value.slug, display_name: value.display_name, context_window: typeof window === "number" && Number.isInteger(window) && window > 0 ? window : null };
};

const parse_models = (value: unknown): AccountModel[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const models: AccountModel[] = [];
  for (const entry of value) {
    const model = parse_account_model(entry);
    if (!model) {
      return null;
    }
    models.push(model);
  }
  return models;
};

const fresh_plain = (): PlainState => ({ version: 1, host_id: `urn:uuid:${randomUUID()}`, notice_seen: false, models: null });

const parse_plain = (value: unknown): PlainState | null => {
  if (!is_record(value) || value.version !== 1 || typeof value.host_id !== "string" || !host_id_pattern.test(value.host_id)) {
    return null;
  }
  return { version: 1, host_id: value.host_id, notice_seen: value.notice_seen === true, models: parse_models(value.models) };
};

export const write_plain = (file: string, plain: PlainState): Promise<void> => write_json(file, plain);

export const read_plain = async (file: string): Promise<PlainState> => {
  const read = await read_json(file);
  if (read.status === "ok") {
    const plain = parse_plain(read.value);
    if (plain) {
      return plain;
    }
  }
  if (read.status !== "missing") {
    const kept = await keep_corrupt(file);
    console.error(`[chatgpt] ${file} is unreadable, kept it as ${kept} and started a fresh one`);
  }
  const plain = fresh_plain();
  try {
    await write_plain(file, plain);
  } catch (error) {
    throw new Error(`writing the ChatGPT state file ${file} failed: ${error_text(error)}`, { cause: error });
  }
  return plain;
};
