import type { AssistantMessage, UserMessage } from "../../shared/chat.ts";
import type { ModelChoice } from "../../shared/models.ts";
import { persist_index, save_edit, schedule_save } from "./persist.ts";
import { attachment_ids, change_refs } from "./refs.ts";
import { bodies, chat_events, metas } from "./state.ts";
import { delete_released, get_chat } from "./store.ts";

export const replace_tail = async (chat_id: string, message_id: string, user: UserMessage, assistant: AssistantMessage, choice: ModelChoice): Promise<void> => {
  const chat = await get_chat(chat_id);
  const body = bodies.get(chat_id);
  const stored = metas.get(chat_id);
  if (!chat || !body || !stored) throw new Error(`chat ${chat_id} is unavailable for editing`);
  const at = body.messages.findIndex((message) => message.id === message_id);
  if (at < 0 || body.messages[at]?.role !== "user") throw new Error(`message ${message_id} is not an editable user message`);
  const previous = body.messages[at - 1];
  const messages = [...body.messages.slice(0, at), user, assistant];
  const summary = body.summary && messages.some((message) => message.id === body.summary?.through_message_id) ? body.summary : null;
  const meta = { ...stored, choice, updated_at: new Date().toISOString(), message_count: messages.length };
  delete meta.archived;
  const next = { ...body, summary, messages };
  let released: string[] = [];
  await save_edit(meta, next, () => {
    const current_body = bodies.get(chat_id) ?? body;
    const current_messages = [...current_body.messages.slice(0, at), user, assistant];
    const current_summary = current_body.summary && current_messages.some((message) => message.id === current_body.summary?.through_message_id) ? current_body.summary : null;
    released = change_refs(attachment_ids(current_body.messages), attachment_ids(current_messages));
    bodies.set(chat_id, { ...current_body, summary: current_summary, messages: current_messages });
    const current = metas.get(chat_id);
    if (current) {
      const edited = { ...current, choice, updated_at: meta.updated_at, message_count: messages.length };
      delete edited.archived;
      metas.set(chat_id, edited);
    }
  });
  schedule_save(chat_id);
  void persist_index().catch((error) => console.error(`[chats] saving the index after editing chat ${chat_id} failed:`, error));
  const current = metas.get(chat_id);
  if (current) {
    chat_events().changed({ ...current });
  }
  chat_events().truncated(chat_id, previous?.id ?? message_id);
  if (previous) {
    chat_events().appended(chat_id, user);
  }
  chat_events().appended(chat_id, assistant);
  await delete_released(chat_id, released);
};
