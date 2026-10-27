import { entry_streaming } from "./chat-view-reduce.ts";
import { chat_view_store } from "./chat-view.ts";
import { chats_store } from "./chats.ts";

export const chat_busy = (chat_id: string): boolean => {
  const streaming = entry_streaming(chat_view_store.get().entries[chat_id]);
  if (streaming !== null) {
    return streaming;
  }
  return chats_store.get().list.find((chat) => chat.id === chat_id)?.streaming ?? false;
};
