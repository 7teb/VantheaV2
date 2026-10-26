import { compact_fraction, type ContextUsage } from "../../../shared/chat.ts";
import { with_context_setting, type ModelEntry } from "../../../shared/models.ts";
import type { ModelContext } from "../../../shared/settings.ts";
import type { MessageKey, Translate } from "../../i18n/translate.ts";
import { chats_store } from "../../state/chats.ts";
import { entry_streaming, last_assistant } from "../../state/chat-view-reduce.ts";
import { chat_view_store } from "../../state/chat-view.ts";
import { find_model, models_store } from "../../state/models.ts";
import { settings_store } from "../../state/settings.ts";
import { use_store } from "../../state/use-store.ts";

export const use_chat_busy = (chat_id: string | null): boolean => {
  const streaming = use_store(chat_view_store, (state) => (chat_id ? entry_streaming(state.entries[chat_id]) : null));
  const listed = use_store(chats_store, (state) => (chat_id ? (state.list.find((chat) => chat.id === chat_id)?.streaming ?? false) : false));
  return streaming ?? listed;
};

export const focus_composer_input = (node: Element) =>
  node.closest(".composer-slot")?.querySelector<HTMLElement>("textarea.composer-input")?.focus({ preventScroll: true });

export const use_context_usage = (chat_id: string | null): ContextUsage | null =>
  use_store(chat_view_store, (state) => {
    const entry = chat_id ? state.entries[chat_id] : undefined;
    if (!entry) {
      return null;
    }
    const live = entry.chat ? last_assistant(entry.chat)?.context : null;
    return entry_streaming(entry) ? (live ?? entry.context) : (entry.context ?? live ?? null);
  });

export type ModelContextChoice = { model: ModelEntry | null; setting: ModelContext | undefined };

export const use_model_context = (): ModelContextChoice => {
  const catalog = use_store(models_store, (state) => state.catalog);
  const model_id = use_store(settings_store, (state) => state?.model ?? null);
  const setting = use_store(settings_store, (state) => (model_id ? state?.model_context[model_id] : undefined));
  return { model: model_id ? find_model(catalog, model_id) : null, setting };
};

export type ShownContext = { usage: ContextUsage | null; compact_at: number | null };

export const use_shown_context = (chat_id: string | null): ShownContext => {
  const { model, setting } = use_model_context();
  const usage = use_context_usage(chat_id);
  const limited = model ? with_context_setting(model, setting) : null;
  return {
    usage: usage && limited ? { ...usage, limit: limited.context_length } : usage,
    compact_at: limited ? (limited.compact_at ?? compact_fraction) : null,
  };
};

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
