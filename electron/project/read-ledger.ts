import fs from "node:fs/promises";
import path from "node:path";
import { as_record } from "../storage/coerce.ts";
import { keep_corrupt, read_json, write_json, writes_settled } from "../storage/json-file.ts";
import { path_key, storage_paths } from "../storage/paths.ts";

type ChatReads = Map<string, Map<string, string>>;

const loaded = new Map<string, Promise<ChatReads>>();

const removed = new Set<string>();

const sha256_pattern = /^[0-9a-f]{64}$/;

const reads_file = (chat_id: string) => path.join(storage_paths().reads, `${chat_id}.json`);

const parse_reads = (value: unknown): ChatReads => {
  const chat: ChatReads = new Map();
  for (const [actor_id, files] of Object.entries(as_record(as_record(value).actors))) {
    const valid = Object.entries(as_record(files)).filter((entry): entry is [string, string] => typeof entry[1] === "string" && sha256_pattern.test(entry[1]));
    if (valid.length > 0) {
      chat.set(actor_id, new Map(valid));
    }
  }
  return chat;
};

const load_reads = async (chat_id: string): Promise<ChatReads> => {
  const file = reads_file(chat_id);
  const read = await read_json(file);
  if (read.status === "missing") {
    return new Map();
  }
  if (read.status === "corrupt") {
    const kept = await keep_corrupt(file);
    console.error(`[reads] the read ledger ${file} is corrupt (${read.error}), it was kept as ${kept} and starts empty`);
    return new Map();
  }
  return parse_reads(read.value);
};

const chat_reads = (chat_id: string): Promise<ChatReads> => {
  const cached = loaded.get(chat_id);
  if (cached) {
    return cached;
  }
  const loading = load_reads(chat_id);
  loaded.set(chat_id, loading);
  loading.catch((error: unknown) => {
    loaded.delete(chat_id);
    console.error(`[reads] loading the read ledger of chat ${chat_id} failed:`, error);
  });
  return loading;
};

const persist = (chat_id: string, chat: ChatReads) => {
  const actors = Object.fromEntries([...chat].map(([actor_id, files]) => [actor_id, Object.fromEntries(files)]));
  write_json(reads_file(chat_id), { version: 1, actors }).catch((error: unknown) => console.error(`[reads] saving the read ledger of chat ${chat_id} failed:`, error));
};

export const record_read = async (chat_id: string, actor_id: string, file: string, sha256: string): Promise<void> => {
  if (removed.has(chat_id)) {
    return;
  }
  const chat = await chat_reads(chat_id);
  if (removed.has(chat_id)) {
    return;
  }
  const files = chat.get(actor_id) ?? new Map<string, string>();
  files.set(path_key(file), sha256);
  chat.set(actor_id, files);
  persist(chat_id, chat);
};

export const read_refusal = async (chat_id: string, actor_id: string, file: string, relative: string, current_sha256: string | null): Promise<string | null> => {
  if (current_sha256 === null) {
    return null;
  }
  const seen = (await chat_reads(chat_id)).get(actor_id)?.get(path_key(file));
  if (seen === undefined) {
    return `You have not read ${relative} yet; read it with read_file before you edit it`;
  }
  if (seen !== current_sha256) {
    return `${relative} changed on disk since you last read it (a command, another agent or the user wrote it); read it again with read_file before you edit it`;
  }
  return null;
};

export const forget_chat_reads = async (chat_id: string): Promise<void> => {
  removed.add(chat_id);
  loaded.delete(chat_id);
  const file = reads_file(chat_id);
  await writes_settled(file);
  await fs.rm(file, { force: true });
};
