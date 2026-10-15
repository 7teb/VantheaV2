import { get_chat } from "../chats/store.ts";
import type { ReasoningStatusCall } from "../turn/session.ts";
import { side_complete } from "./model.ts";
import { clean_status, recent_user_texts, status_messages } from "./status-prompt.ts";

export const reasoning_status_call: ReasoningStatusCall = async (request, signal) => {
  const chat = await get_chat(request.chat_id);
  const messages = status_messages({ ...request, user_texts: recent_user_texts(chat?.messages ?? []) });
  const reply = await side_complete("reasoning_status", messages, null, signal, { reasoning_effort: "minimal" });
  return clean_status(reply.text);
};
