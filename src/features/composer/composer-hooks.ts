import { compact_fraction, type ContextUsage } from "../../../shared/chat.ts";
import { with_context_setting, type ModelChoice, type ModelEntry } from "../../../shared/models.ts";
import type { ModelContext } from "../../../shared/settings.ts";
import type { MessageKey, Translate } from "../../i18n/translate.ts";
import { chats_store } from "../../state/chats.ts";
import { entry_streaming, last_assistant } from "../../state/chat-view-reduce.ts";
import { chat_view_store } from "../../state/chat-view.ts";
import { layout_store } from "../../state/layout.ts";
import { resolve_choice } from "../../state/model-choice.ts";
import { models_store } from "../../state/models.ts";
import { settings_store } from "../../state/settings.ts";
import { ui_store } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";

export const use_chat_busy = (chat_id: string | null): boolean => {
  const streaming = use_store(chat_view_store, (state) => (chat_id ? entry_streaming(state.entries[chat_id]) : null));
  const listed = use_store(chats_store, (state) => (chat_id ? (state.list.find((chat) => chat.id === chat_id)?.streaming ?? false) : false));
  return streaming ?? listed;
};

export const focus_composer_input = (node: Element) =>
  node.closest(".composer-slot")?.querySelector<HTMLElement>("textarea.composer-input")?.focus({ preventScroll: true });

export const return_focus_to_composer = (node: Element) => {
  if (!layout_store.get().touch) {
    focus_composer_input(node);
  }
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

export type ModelContextChoice = { model: ModelEntry | null; setting: ModelContext | undefined };

export const use_model_choice = (chat_id: string | null): ModelChoice | null => {
  const catalog = use_store(models_store, (state) => state.catalog);
  const settings = use_store(settings_store, (state) => state);
  const stored = use_store(chats_store, (state) => (chat_id === null ? undefined : state.list.find((chat) => chat.id === chat_id)?.choice));
  const messages = use_store(chat_view_store, (state) => (chat_id === null ? undefined : state.entries[chat_id]?.chat?.messages));
  const new_chat_pro = use_store(ui_store, (state) => state.new_chat_pro);
  const new_chat_tier = use_store(ui_store, (state) => state.new_chat_tier);
  return resolve_choice(chat_id, stored, messages, catalog, settings, new_chat_pro, new_chat_tier);
};

export const use_model_context = (chat_id: string | null): ModelContextChoice => {
  const catalog = use_store(models_store, (state) => state.catalog);
  const model_id = use_model_choice(chat_id)?.model ?? null;
  const setting = use_store(settings_store, (state) => (model_id ? state?.model_context[model_id] : undefined));
  return { model: model_id ? (catalog?.models.find((entry) => entry.id === model_id) ?? null) : null, setting };
};

export type ShownContext = { usage: ContextUsage | null; compact_at: number | null };

export const use_shown_context = (chat_id: string | null): ShownContext => {
  const { model, setting } = use_model_context(chat_id);
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
