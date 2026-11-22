import type { ClaudeSessionRef } from "../claude/runtime.ts";
import { save_now } from "./persist.ts";
import { bodies, type ChatBody } from "./state.ts";
import { get_chat } from "./store.ts";

const loaded_body = async (chat_id: string): Promise<ChatBody | null> => ((await get_chat(chat_id)) ? (bodies.get(chat_id) ?? null) : null);

export const claude_session_of = async (chat_id: string): Promise<ClaudeSessionRef | null> => (await loaded_body(chat_id))?.claude_session ?? null;

export const set_claude_session = async (chat_id: string, ref: ClaudeSessionRef | null): Promise<void> => {
  await get_chat(chat_id);
  const body = bodies.get(chat_id);
  if (!body) {
    if (ref) {
      throw new Error(`chat ${chat_id} no longer exists, so Claude Code session ${ref.session_id} is not stored with it`);
    }
    return;
  }
  const next: ChatBody = { ...body };
  if (ref) {
    next.claude_session = ref;
  } else {
    delete next.claude_session;
  }
  bodies.set(chat_id, next);
  await save_now(chat_id);
};
