import type { ContextUsage } from "../../../shared/chat.ts";
import type { MessageKey, Translate } from "../../i18n/translate.ts";
import { chats_store } from "../../state/chats.ts";
import { entry_streaming, last_assistant } from "../../state/chat-view-reduce.ts";
import { chat_view_store } from "../../state/chat-view.ts";
import { use_store } from "../../state/use-store.ts";

export const use_chat_busy = (chat_id: string | null): boolean => {
  const streaming = use_store(chat_view_store, (state) => (chat_id ? entry_streaming(state.entries[chat_id]) : null));
  const listed = use_store(chats_store, (state) => (chat_id ? (state.list.find((chat) => chat.id === chat_id)?.streaming ?? false) : false));
  return streaming ?? listed;
};

export const use_context_usage = (chat_id: string | null): ContextUsage | null =>
  use_store(chat_view_store, (state) => {
    const entry = chat_id ? state.entries[chat_id] : undefined;
    if (!entry) {
      return null;
    }
    const live = entry.chat ? last_assistant(entry.chat)?.context : null;
    return entry_streaming(entry) ? (live ?? entry.context) : (entry.context ?? live ?? null);
  });

const effort_keys: Record<string, MessageKey> = {
  none: "composer.effort_none",
  minimal: "composer.effort_minimal",
  low: "composer.effort_low",
  medium: "composer.effort_medium",
  high: "composer.effort_high",
  xhigh: "composer.effort_xhigh",
  max: "composer.effort_max",
  major: "composer.effort_major",
};

export const effort_label = (t: Translate, effort: string) => {
  const key = effort_keys[effort];
  return key ? t(key) : effort;
};
