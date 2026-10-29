import type { Message } from "../../shared/chat.ts";
import { chat_choice, type ModelCatalog, type ModelChoice, type SpeedTier } from "../../shared/models.ts";
import type { Settings } from "../../shared/settings.ts";
import { chat_view_store } from "./chat-view.ts";
import { chats_store, set_chat_choice } from "./chats.ts";
import { models_store } from "./models.ts";
import { settings_store, update_settings } from "./settings.ts";
import { ui_store } from "./ui.ts";

export const resolve_choice = (
  chat_id: string | null,
  stored: ModelChoice | undefined,
  messages: readonly Message[] | undefined,
  catalog: ModelCatalog | null,
  settings: Pick<Settings, "model" | "effort"> | null,
  new_chat_pro: boolean,
  new_chat_tier: SpeedTier | null,
): ModelChoice | null => {
  if (!settings) {
    return null;
  }
  if (chat_id === null) {
    return { model: settings.model, effort: settings.effort, pro: new_chat_pro, ...(new_chat_tier ? { tier: new_chat_tier } : {}) };
  }
  return chat_choice(stored, messages, catalog, { model: settings.model, effort: settings.effort, pro: false });
};

export const choice_for = (chat_id: string | null): ModelChoice | null =>
  resolve_choice(
    chat_id,
    chat_id === null ? undefined : chats_store.get().list.find((chat) => chat.id === chat_id)?.choice,
    chat_id === null ? undefined : chat_view_store.get().entries[chat_id]?.chat?.messages,
    models_store.get().catalog,
    settings_store.get(),
    ui_store.get().new_chat_pro,
    ui_store.get().new_chat_tier,
  );

export const set_choice = async (chat_id: string | null, choice: ModelChoice) => {
  try {
    if (chat_id === null) {
      ui_store.update((state) => ({ ...state, new_chat_pro: choice.pro, new_chat_tier: choice.tier ?? null }));
    } else {
      await set_chat_choice(chat_id, choice);
    }
    await update_settings({ model: choice.model, effort: choice.effort });
  } catch (error) {
    console.error(`[models] saving the model choice ${choice.model} for chat ${chat_id ?? "new"} failed`, error);
  }
};

export const toggle_pro = (chat_id: string | null) => {
  const choice = choice_for(chat_id);
  if (choice) {
    void set_choice(chat_id, { ...choice, pro: !choice.pro });
  }
};

export const toggle_tier = (chat_id: string | null, tier: SpeedTier) => {
  const choice = choice_for(chat_id);
  if (!choice) {
    return;
  }
  const { tier: current, ...rest } = choice;
  void set_choice(chat_id, current === tier ? rest : { ...rest, tier });
};

export const take_new_chat_choice = (): ModelChoice | null => {
  const choice = choice_for(null);
  ui_store.update((state) => ({ ...state, new_chat_pro: false, new_chat_tier: null }));
  return choice;
};
