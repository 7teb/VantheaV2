import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { get_settings } from "../settings/store.ts";

const wanted_languages = ["de-DE", "en-US"];

const dictionary_label = { en: "Add to dictionary", de: "Zum Wörterbuch hinzufügen" } as const;

const no_suggestions_label = { en: "No suggestions", de: "Keine Vorschläge" } as const;

export const init_spellcheck = (window: BrowserWindow) => {
  const session = window.webContents.session;
  const available = session.availableSpellCheckerLanguages;
  const languages = wanted_languages.filter((language) => available.includes(language));
  if (languages.length < wanted_languages.length) {
    console.warn(`[spellcheck] languages ${wanted_languages.join(", ")} requested, available are only ${languages.join(", ") || "none"}`);
  }
  try {
    session.setSpellCheckerLanguages(languages);
  } catch (error) {
    console.error(`[spellcheck] setting languages ${languages.join(", ")} failed:`, error);
  }
  window.webContents.on("context-menu", (_event, params) => {
    if (!params.isEditable || !params.misspelledWord) {
      return;
    }
    const language = get_settings().language;
    const suggestions: MenuItemConstructorOptions[] = params.dictionarySuggestions.map((word) => ({
      label: word,
      click: () => window.webContents.replaceMisspelling(word),
    }));
    const items: MenuItemConstructorOptions[] = [
      ...(suggestions.length ? suggestions : [{ label: no_suggestions_label[language], enabled: false }]),
      { type: "separator" },
      { label: dictionary_label[language], click: () => session.addWordToSpellCheckerDictionary(params.misspelledWord) },
    ];
    Menu.buildFromTemplate(items).popup({ window });
  });
};
