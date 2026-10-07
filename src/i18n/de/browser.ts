import type { browser as en } from "../en/browser.ts";

export const browser: Record<keyof typeof en, string> = {
  "browser.open": "Browser",
  "browser.new_tab": "Neuer Tab",
  "browser.tab_n": "Tab {n}",
  "browser.add_tab": "Neuer Tab",
  "browser.close_tab": "Tab schließen",
  "browser.close": "Browser schließen",
  "browser.fullscreen": "Vollbild",
  "browser.exit_fullscreen": "Vollbild verlassen",
  "browser.back": "Zurück",
  "browser.forward": "Vorwärts",
  "browser.reload": "Neu laden",
  "browser.url_placeholder": "Suchen oder Adresse eingeben",
  "browser.load_failed": "Seite konnte nicht geladen werden",
  "browser.crashed": "Die Seite ist abgestürzt",
  "browser.tabs": "Browser-Tabs",
  "browser.unavailable": "Der Browser konnte nicht starten",
};
