import type { ChatMeta } from "../../shared/chat.ts";
import { write_file_atomic, write_file_atomic_sync, write_json, write_json_sync } from "../storage/json-file.ts";
import { chat_file, encode_chat, encode_chat_sync, search_file, search_text, serialize_index } from "./files.ts";
import { bodies, chat_dirs, metas, type ChatBody } from "./state.ts";

type SaveState = { dirty: boolean; writing: boolean; timer: ReturnType<typeof setTimeout> | null; last_write: number; chain: Promise<void> };

const save_interval_ms = 2000;

const saves = new Map<string, SaveState>();

const save_state = (chat_id: string): SaveState => {
  const existing = saves.get(chat_id);
  if (existing) {
    return existing;
  }
  const created: SaveState = { dirty: false, writing: false, timer: null, last_write: 0, chain: Promise.resolve() };
  saves.set(chat_id, created);
  return created;
};

const clear_timer = (state: SaveState) => {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
};

const write_chat = async (chat_id: string, state: SaveState) => {
  const meta = metas.get(chat_id);
  const body = bodies.get(chat_id);
  if (!meta || !body) {
    state.dirty = false;
    return;
  }
  state.dirty = false;
  state.writing = true;
  state.last_write = Date.now();
  try {
    const packed = await encode_chat(meta, body);
    if (!metas.has(chat_id)) {
      return;
    }
    await write_file_atomic(chat_file(chat_id), packed);
    await write_file_atomic(search_file(chat_id), search_text(body.messages));
  } catch (error) {
    state.dirty = true;
    throw error;
  } finally {
    state.writing = false;
  }
};

const enqueue_write = (chat_id: string, state: SaveState): Promise<void> => {
  const run = state.chain.then(() => (state.dirty ? write_chat(chat_id, state) : undefined));
  state.chain = run.then(
    () => undefined,
    (error) => {
      console.error(`[chats] saving chat ${chat_id} failed:`, error);
    },
  );
  return run;
};

export const save_now = (chat_id: string): Promise<void> => {
  const state = save_state(chat_id);
  clear_timer(state);
  state.dirty = true;
  return enqueue_write(chat_id, state);
};

export const schedule_save = (chat_id: string) => {
  const state = save_state(chat_id);
  state.dirty = true;
  if (state.timer) {
    return;
  }
  const wait = Math.max(0, state.last_write + save_interval_ms - Date.now());
  state.timer = setTimeout(() => {
    state.timer = null;
    void enqueue_write(chat_id, state);
  }, wait);
  state.timer.unref();
};

export const flush_chat = async (chat_id: string) => {
  const state = saves.get(chat_id);
  if (!state) {
    return;
  }
  clear_timer(state);
  await enqueue_write(chat_id, state);
};

export const save_pending = (chat_id: string): boolean => {
  const state = saves.get(chat_id);
  return Boolean(state && (state.dirty || state.writing || state.timer));
};

export const forget_saves = async (chat_id: string) => {
  const state = saves.get(chat_id);
  if (!state) {
    return;
  }
  clear_timer(state);
  state.dirty = false;
  await state.chain;
  saves.delete(chat_id);
};

export const reset_saves = () => {
  for (const state of saves.values()) {
    clear_timer(state);
  }
  saves.clear();
};

export const persist_index = () => write_json(chat_dirs().index_file, serialize_index());

export const write_chat_direct = async (meta: ChatMeta, body: ChatBody) => {
  await write_file_atomic(chat_file(meta.id), await encode_chat(meta, body));
  await write_file_atomic(search_file(meta.id), search_text(body.messages));
};

export const flush_all_sync = () => {
  for (const [chat_id, state] of saves) {
    if (!state.dirty && !state.writing && !state.timer) {
      continue;
    }
    clear_timer(state);
    const meta = metas.get(chat_id);
    const body = bodies.get(chat_id);
    if (!meta || !body) {
      continue;
    }
    try {
      write_file_atomic_sync(chat_file(chat_id), encode_chat_sync(meta, body));
      write_file_atomic_sync(search_file(chat_id), search_text(body.messages));
      state.dirty = false;
    } catch (error) {
      console.error(`[chats] saving chat ${chat_id} on quit failed:`, error);
    }
  }
  try {
    write_json_sync(chat_dirs().index_file, serialize_index());
  } catch (error) {
    console.error("[chats] saving the chat index on quit failed:", error);
  }
};
