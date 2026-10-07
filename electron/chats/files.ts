import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, brotliCompressSync, brotliDecompress, constants as zlib_constants } from "node:zlib";
import type { Chat, ChatMeta, ChatSummary, Message, RoundReasoning } from "../../shared/chat.ts";
import { is_media_id } from "../media/files.ts";
import { as_array, as_boolean, as_iso, as_number, as_record, as_string, error_code, is_record } from "../storage/coerce.ts";
import { chat_dirs, metas, refs, sorted_metas, type ChatBody } from "./state.ts";

const compress = promisify(brotliCompress);
const decompress = promisify(brotliDecompress);
const brotli_options = { params: { [zlib_constants.BROTLI_PARAM_QUALITY]: 4 } };

export const chat_id_pattern = /^[A-Za-z0-9_-]{1,64}$/;

const max_search_chars = 120_000;

export const chat_file = (chat_id: string) => path.join(chat_dirs().data_dir, `${chat_id}.vxc`);

export const search_file = (chat_id: string) => path.join(chat_dirs().search_dir, `${chat_id}.txt`);

const chat_json = (meta: ChatMeta, body: ChatBody) => JSON.stringify({ version: 1, ...meta, streaming: false, ...body });

export const encode_chat = (meta: ChatMeta, body: ChatBody): Promise<Buffer> => compress(Buffer.from(chat_json(meta, body), "utf8"), brotli_options);

export const encode_chat_sync = (meta: ChatMeta, body: ChatBody): Buffer => brotliCompressSync(Buffer.from(chat_json(meta, body), "utf8"), brotli_options);

const decode_chat = async (packed: Buffer): Promise<unknown> => JSON.parse((await decompress(packed)).toString("utf8"));

export const parse_meta = (value: unknown, fallback_time: string): ChatMeta | null => {
  const raw = as_record(value);
  const id = as_string(raw.id);
  if (!chat_id_pattern.test(id)) {
    return null;
  }
  const created_at = as_iso(raw.created_at, fallback_time);
  return {
    id,
    title: as_string(raw.title).slice(0, 200),
    project_path: as_string(raw.project_path),
    workspace: as_string(raw.workspace),
    pinned: as_boolean(raw.pinned, false),
    created_at,
    updated_at: as_iso(raw.updated_at, created_at),
    message_count: Math.max(0, Math.floor(as_number(raw.message_count, 0))),
    streaming: false,
  };
};

const is_message = (value: unknown): value is Message =>
  is_record(value) &&
  typeof value.id === "string" &&
  ((value.role === "user" && Array.isArray(value.attachments)) || (value.role === "assistant" && Array.isArray(value.steps)));

const parse_round_reasoning = (value: unknown): RoundReasoning[] => {
  const raw = as_record(value);
  return typeof raw.round === "number" && Array.isArray(raw.details) ? [{ round: raw.round, details: raw.details }] : [];
};

const parse_message = (message: Message): Message =>
  message.role === "assistant" ? { ...message, reasoning_details: as_array(as_record(message).reasoning_details).flatMap(parse_round_reasoning) } : message;

const parse_summary = (value: unknown): ChatSummary | null => {
  const raw = as_record(value);
  const text = as_string(raw.text);
  const through = as_string(raw.through_message_id);
  return text && through ? { text, through_message_id: through } : null;
};

export const parse_body = (value: unknown): ChatBody | null => {
  const raw = as_record(value);
  if (!Array.isArray(raw.messages)) {
    return null;
  }
  return { summary: parse_summary(raw.summary), messages: raw.messages.filter(is_message).map(parse_message) };
};

export const read_chat_file = async (chat_id: string): Promise<{ meta: ChatMeta; body: ChatBody } | null> => {
  let packed: Buffer;
  try {
    packed = await fs.readFile(chat_file(chat_id));
  } catch (error) {
    if (error_code(error) === "ENOENT") {
      console.error(`[chats] chat file for ${chat_id} is missing`);
      return null;
    }
    throw error;
  }
  const value = await decode_chat(packed);
  const meta = parse_meta(value, new Date().toISOString());
  const body = parse_body(value);
  if (!meta || !body || meta.id !== chat_id) {
    console.error(`[chats] chat file for ${chat_id} does not hold a valid chat`);
    return null;
  }
  return { meta, body };
};

export const compose_chat = (meta: ChatMeta, body: ChatBody): Chat => ({ ...meta, summary: body.summary, messages: body.messages });

export const search_text = (messages: Message[]): string => {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      parts.push(message.text);
      continue;
    }
    for (const step of message.steps) {
      if (step.kind === "text") {
        parts.push(step.text);
      }
    }
  }
  return parts.join("\n").slice(0, max_search_chars);
};

export const read_search_text = async (chat_id: string): Promise<string> => {
  try {
    return await fs.readFile(search_file(chat_id), "utf8");
  } catch (error) {
    if (error_code(error) === "ENOENT") {
      return "";
    }
    console.error(`[chats] reading search text of ${chat_id} failed:`, error);
    return "";
  }
};

export const serialize_index = () => ({
  version: 1,
  chats: sorted_metas().map((meta) => ({ ...meta, streaming: false })),
  refs: Object.fromEntries(refs),
});

export const load_index = (value: unknown) => {
  const raw = as_record(value);
  const now = new Date().toISOString();
  let dropped = 0;
  for (const entry of Array.isArray(raw.chats) ? raw.chats : []) {
    const meta = parse_meta(entry, now);
    if (!meta) {
      dropped += 1;
      continue;
    }
    metas.set(meta.id, meta);
  }
  for (const [id, count] of Object.entries(as_record(raw.refs))) {
    const value = Math.floor(as_number(count, 0));
    if (value > 0 && is_media_id(id)) {
      refs.set(id, value);
    }
  }
  if (dropped) {
    console.error(`[chats] dropped ${dropped} invalid entries from the chat index`);
  }
};

export const delete_chat_files = async (chat_id: string) => {
  await fs.rm(chat_file(chat_id), { force: true });
  await fs.rm(search_file(chat_id), { force: true });
};
