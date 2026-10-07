import { useCallback } from "react";
import type { Language } from "../../shared/settings.ts";
import { create_store } from "../state/create-store.ts";
import { use_store } from "../state/use-store.ts";
import { is_language, translate, type MessageKey, type MessageVars, type Translate } from "./translate.ts";

export type { MessageKey, MessageVars, Translate };

const storage_key = "vx:language";

const remembered_language = (): Language => {
  try {
    const value = localStorage.getItem(storage_key);
    return is_language(value) ? value : "en";
  } catch (error) {
    console.error("[i18n] reading the remembered language failed", error);
    return "en";
  }
};

export const language_store = create_store<Language>(remembered_language());

document.documentElement.lang = language_store.get();

export const set_language = (language: Language) => {
  if (language === language_store.get()) {
    return;
  }
  language_store.set(language);
  document.documentElement.lang = language;
  try {
    localStorage.setItem(storage_key, language);
  } catch (error) {
    console.error(`[i18n] remembering language ${language} failed`, error);
  }
};

export const t: Translate = (key, vars) => translate(language_store.get(), key, vars);

const select_language = (language: Language) => language;

export const use_t = (): Translate => {
  const language = use_store(language_store, select_language);
  return useCallback<Translate>((key, vars) => translate(language, key, vars), [language]);
};
