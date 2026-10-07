import { randomUUID } from "node:crypto";
import type { Chat, ChatMeta, ChatSummary, Message } from "../../shared/chat.ts";
import { delete_attachment } from "../media/files.ts";
import { path_key } from "../storage/paths.ts";
import { load_chat_index } from "./boot.ts";
import { compose_chat, delete_chat_files, read_chat_file } from "./files.ts";
import { forget_saves, persist_index, reset_saves, save_now, save_pending, schedule_save } from "./persist.ts";
import { attachment_ids, change_refs, same_ids } from "./refs.ts";
import { settle_streaming } from "./settle.ts";
import { bodies, chat_events, metas, reset_chat_state, sorted_metas, type ChatBody, type ChatDirs, type ChatEvents } from "./state.ts";

export { flush_all_sync, flush_chat } from "./persist.ts";
export { search_chats } from "./search.ts";

export type ChatsInit = { dirs: ChatDirs; legacy_root: string; events: ChatEvents };

export type MetaPatch = Partial<Pick<ChatMeta, "title" | "pinned" | "workspace" | "project_path">>;

const max_cached_chats = 16;

const loading = new Map<string, Promise<ChatBody | null>>();

const deleting = new Set<string>();

export const init_chats = async (options: ChatsInit) => {
  reset_saves();
  loading.clear();
  deleting.clear();
  reset_chat_state(options.dirs, options.events);
  await load_chat_index(options.dirs, options.legacy_root);
};

const now_iso = () => new Date().toISOString();

const require_meta = (chat_id: string): ChatMeta => {
  const meta = metas.get(chat_id);
  if (!meta) {
    throw new Error(`chat ${chat_id} not found`);
  }
  return meta;
};

const announce = (chat_id: string) => {
  const meta = metas.get(chat_id);
  if (meta) {
    chat_events().changed({ ...meta });
  }
};

const queue_index = () => {
  persist_index().catch((error: unknown) => {
    console.error("[chats] saving the chat index failed:", error);
  });
};

const in_turn = (chat_id: string, body: ChatBody) => {
  const last = body.messages.at(-1);
  return Boolean(metas.get(chat_id)?.streaming) || (last?.role === "assistant" && last.status === "streaming");
};

const evict = () => {
  for (const [chat_id, body] of bodies) {
    if (bodies.size <= max_cached_chats) {
      return;
    }
    if (!save_pending(chat_id) && !in_turn(chat_id, body) && !loading.has(chat_id)) {
      bodies.delete(chat_id);
    }
  }
};

const cache_body = (chat_id: string, body: ChatBody) => {
  bodies.delete(chat_id);
  bodies.set(chat_id, body);
  evict();
};

const load_body = async (chat_id: string): Promise<ChatBody | null> => {
  let stored: Awaited<ReturnType<typeof read_chat_file>>;
  try {
    stored = await read_chat_file(chat_id);
  } catch (error) {
    console.error(`[chats] reading chat ${chat_id} failed:`, error);
    return null;
  }
  if (!stored || !metas.has(chat_id)) {
    return null;
  }
  const settled = metas.get(chat_id)?.streaming ? null : settle_streaming(stored.body.messages, Date.now());
  const body = settled ? { ...stored.body, messages: settled } : stored.body;
  cache_body(chat_id, body);
  if (settled) {
    void save_now(chat_id);
  }
  return body;
};

const ensure_body = (chat_id: string): Promise<ChatBody | null> => {
  const cached = bodies.get(chat_id);
  if (cached) {
    cache_body(chat_id, cached);
    return Promise.resolve(cached);
  }
  if (!metas.has(chat_id)) {
    return Promise.resolve(null);
  }
  const pending = loading.get(chat_id);
  if (pending) {
    return pending;
  }
  const load = load_body(chat_id).finally(() => loading.delete(chat_id));
  loading.set(chat_id, load);
  return load;
};

const require_body = async (chat_id: string): Promise<ChatBody> => {
  const body = await ensure_body(chat_id);
  if (!body) {
    throw new Error(`chat ${chat_id} not found or unreadable`);
  }
  return body;
};

const commit = async (chat_id: string, body: ChatBody, meta_patch: Partial<ChatMeta>) => {
  bodies.set(chat_id, body);
  metas.set(chat_id, { ...require_meta(chat_id), ...meta_patch });
  await save_now(chat_id);
  await persist_index();
  announce(chat_id);
};

export const list_chats = (): ChatMeta[] => sorted_metas().map((meta) => ({ ...meta }));

export const chat_meta = (chat_id: string): ChatMeta | null => {
  const meta = metas.get(chat_id);
  return meta ? { ...meta } : null;
};

export const get_chat = async (chat_id: string): Promise<Chat | null> => {
  const body = await ensure_body(chat_id);
  const meta = metas.get(chat_id);
  return body && meta ? compose_chat(meta, body) : null;
};

export const create_chat = async (project_path: string): Promise<ChatMeta> => {
  const now = now_iso();
  const meta: ChatMeta = {
    id: randomUUID(),
    title: "",
    project_path,
    workspace: "",
    pinned: false,
    created_at: now,
    updated_at: now,
    message_count: 0,
    streaming: false,
  };
  metas.set(meta.id, meta);
  cache_body(meta.id, { summary: null, messages: [] });
  await save_now(meta.id);
  await persist_index();
  announce(meta.id);
  return { ...meta };
};

export const update_meta = async (chat_id: string, patch: MetaPatch): Promise<ChatMeta> => {
  const meta = require_meta(chat_id);
  const next: ChatMeta = {
    ...meta,
    title: patch.title === undefined ? meta.title : patch.title.trim().slice(0, 200),
    pinned: patch.pinned ?? meta.pinned,
    workspace: patch.workspace ?? meta.workspace,
    project_path: patch.project_path ?? meta.project_path,
  };
  metas.set(chat_id, next);
  if (bodies.has(chat_id)) {
    schedule_save(chat_id);
  }
  await persist_index();
  announce(chat_id);
  return { ...next };
};

export const delete_chat = async (chat_id: string): Promise<void> => {
  if (!metas.has(chat_id) || deleting.has(chat_id)) {
    return;
  }
  deleting.add(chat_id);
  try {
    await remove_chat(chat_id);
  } finally {
    deleting.delete(chat_id);
  }
};

const remove_chat = async (chat_id: string): Promise<void> => {
  const body = await ensure_body(chat_id);
  await forget_saves(chat_id);
  metas.delete(chat_id);
  bodies.delete(chat_id);
  const released = body ? change_refs(attachment_ids(body.messages), new Set()) : [];
  if (!body) {
    console.error(`[chats] chat ${chat_id} was unreadable, its attachment references could not be released`);
  }
  await delete_chat_files(chat_id);
  await persist_index();
  for (const attachment_id of released) {
    try {
      await delete_attachment(attachment_id);
    } catch (error) {
      console.error(`[chats] deleting attachment ${attachment_id} of chat ${chat_id} failed:`, error);
    }
  }
  chat_events().removed(chat_id);
  for (const listener of removed_listeners) {
    try {
      listener(chat_id);
    } catch (error) {
      console.error(`[chats] cleanup after deleting chat ${chat_id} failed:`, error);
    }
  }
};

const removed_listeners = new Set<(chat_id: string) => void>();

export const on_chat_removed = (listener: (chat_id: string) => void): (() => void) => {
  removed_listeners.add(listener);
  return () => {
    removed_listeners.delete(listener);
  };
};

export const project_chat_ids = (project_path: string): string[] => {
  const key = path_key(project_path);
  return [...metas.values()].filter((meta) => path_key(meta.project_path) === key).map((meta) => meta.id);
};

export const fork_chat = async (chat_id: string, message_id: string): Promise<ChatMeta> => {
  const body = await require_body(chat_id);
  const meta = require_meta(chat_id);
  const at = body.messages.findIndex((message) => message.id === message_id);
  if (at < 0) {
    throw new Error(`message ${message_id} not found in chat ${chat_id}`);
  }
  const messages = structuredClone(body.messages.slice(0, at + 1));
  if (messages.some((message) => message.role === "assistant" && message.status === "streaming")) {
    throw new Error("cannot fork at a turn that is still running");
  }
  const summary = body.summary && messages.some((message) => message.id === body.summary?.through_message_id) ? { ...body.summary } : null;
  const now = now_iso();
  const fork: ChatMeta = {
    ...meta,
    id: randomUUID(),
    title: meta.title ? `${meta.title} (fork)` : "",
    pinned: false,
    created_at: now,
    updated_at: now,
    message_count: messages.length,
    streaming: false,
  };
  metas.set(fork.id, fork);
  cache_body(fork.id, { summary, messages });
  change_refs(new Set(), attachment_ids(messages));
  await save_now(fork.id);
  await persist_index();
  announce(fork.id);
  return { ...fork };
};

export const append_message = async (chat_id: string, message: Message): Promise<void> => {
  const body = await require_body(chat_id);
  if (body.messages.some((entry) => entry.id === message.id)) {
    throw new Error(`message ${message.id} already exists in chat ${chat_id}`);
  }
  const messages = [...body.messages, message];
  if (message.role === "user") {
    change_refs(attachment_ids(body.messages), attachment_ids(messages));
  }
  await commit(chat_id, { ...body, messages }, { message_count: messages.length, updated_at: now_iso() });
  chat_events().appended(chat_id, message);
};

export const update_message = (chat_id: string, message_id: string, fn: (message: Message) => Message): void => {
  const body = bodies.get(chat_id);
  if (!body) {
    if (metas.has(chat_id)) {
      throw new Error(`chat ${chat_id} is not loaded, call get_chat before update_message`);
    }
    return;
  }
  const at = body.messages.findIndex((message) => message.id === message_id);
  const before = body.messages[at];
  if (!before) {
    throw new Error(`message ${message_id} not found in chat ${chat_id}`);
  }
  const messages = body.messages.slice();
  const after = fn(before);
  messages[at] = after;
  bodies.set(chat_id, { ...body, messages });
  if (!same_ids(attachment_ids([before]), attachment_ids([after]))) {
    change_refs(attachment_ids(body.messages), attachment_ids(messages));
    queue_index();
  }
  schedule_save(chat_id);
};

export const truncate_after = async (chat_id: string, message_id: string): Promise<void> => {
  const body = await require_body(chat_id);
  const at = body.messages.findIndex((message) => message.id === message_id);
  if (at < 0) {
    throw new Error(`message ${message_id} not found in chat ${chat_id}`);
  }
  if (at === body.messages.length - 1) {
    return;
  }
  const messages = body.messages.slice(0, at + 1);
  change_refs(attachment_ids(body.messages), attachment_ids(messages));
  const summary = body.summary && messages.some((message) => message.id === body.summary?.through_message_id) ? body.summary : null;
  await commit(chat_id, { summary, messages }, { message_count: messages.length, updated_at: now_iso() });
  chat_events().truncated(chat_id, message_id);
};

export const set_summary = async (chat_id: string, summary: ChatSummary | null): Promise<void> => {
  const body = await require_body(chat_id);
  bodies.set(chat_id, { ...body, summary });
  await save_now(chat_id);
};

export const set_streaming = (chat_id: string, streaming: boolean): void => {
  const meta = metas.get(chat_id);
  if (!meta || meta.streaming === streaming) {
    return;
  }
  metas.set(chat_id, { ...meta, streaming });
  announce(chat_id);
};
