import type { ApprovalDecision } from "../../shared/approval.ts";
import { api } from "../api/bridge.ts";
import { mark_reverted } from "./chat-view-reduce.ts";
import { chat_view_store } from "./chat-view.ts";
import { open_chat } from "./ui.ts";

export type ActionResult = { ok: true } | { ok: false; error: string };

const failure = (error: unknown): ActionResult => ({ ok: false, error: error instanceof Error ? error.message : String(error) });

const ok: ActionResult = { ok: true };

export const edit_message = async (chat_id: string, message_id: string, text: string): Promise<ActionResult> => {
  try {
    await api.invoke("turn:edit", chat_id, message_id, text);
    return ok;
  } catch (error) {
    console.error(`[chat] turn:edit failed for chat ${chat_id} message ${message_id}`, error);
    return failure(error);
  }
};

export const fork_chat = async (chat_id: string, message_id: string): Promise<ActionResult> => {
  try {
    const meta = await api.invoke("chats:fork", chat_id, message_id);
    open_chat(meta.id, meta.project_path);
    return ok;
  } catch (error) {
    console.error(`[chat] chats:fork failed for chat ${chat_id} message ${message_id}`, error);
    return failure(error);
  }
};

export const continue_turn = async (chat_id: string): Promise<ActionResult> => {
  try {
    await api.invoke("turn:continue", chat_id);
    return ok;
  } catch (error) {
    console.error(`[chat] turn:continue failed for chat ${chat_id}`, error);
    return failure(error);
  }
};

export const accept_plan = async (chat_id: string, message_id: string): Promise<ActionResult> => {
  try {
    await api.invoke("turn:accept_plan", chat_id, message_id);
    return ok;
  } catch (error) {
    console.error(`[chat] turn:accept_plan failed for chat ${chat_id} message ${message_id}`, error);
    return failure(error);
  }
};

export const undo_turn = async (chat_id: string, message_id: string): Promise<ActionResult> => {
  try {
    const result = await api.invoke("turn:undo", chat_id, message_id);
    chat_view_store.update((state) => mark_reverted(state, chat_id, message_id, result));
    return ok;
  } catch (error) {
    console.error(`[chat] turn:undo failed for chat ${chat_id} message ${message_id}`, error);
    return failure(error);
  }
};

export const answer_approval = async (chat_id: string, call_id: string, decision: ApprovalDecision): Promise<ActionResult> => {
  try {
    await api.invoke("turn:approve", chat_id, call_id, decision);
    return ok;
  } catch (error) {
    console.error(`[chat] turn:approve failed for chat ${chat_id} call ${call_id}`, error);
    return failure(error);
  }
};

const external_pattern = /^(https?:|mailto:)/i;

export const is_external_url = (url: string) => external_pattern.test(url);

export const open_external = (url: string) => {
  if (!is_external_url(url)) {
    return;
  }
  api.invoke("shell:open_external", url).catch((error) => console.error(`[chat] shell:open_external failed for ${url}`, error));
};

export const copy_text = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error(`[chat] clipboard write failed for ${text.length} chars`, error);
    return false;
  }
};
