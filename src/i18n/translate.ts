import type { Language } from "../../shared/settings.ts";
import { de } from "./de/index.ts";
import { en, type MessageKey } from "./en/index.ts";

export type { MessageKey };

export type MessageVars = Record<string, string | number>;

export type Translate = (key: MessageKey, vars?: MessageVars) => string;

export const tables: Record<Language, Record<MessageKey, string>> = { en, de };

export const languages: Language[] = ["en", "de"];

export const translate = (language: Language, key: MessageKey, vars?: MessageVars): string => {
  const template = tables[language][key];
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : match));
};

export const is_language = (value: unknown): value is Language => languages.includes(value as Language);
