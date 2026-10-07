import type { terminal as en } from "../en/terminal.ts";

export const terminal: Record<keyof typeof en, string> = {
  "terminal.title": "Terminal",
  "terminal.title_n": "Terminal {n}",
  "terminal.open": "Terminal",
  "terminal.new": "Neues Terminal",
  "terminal.close": "Terminal schließen",
  "terminal.close_tab": "Tab schließen",
  "terminal.fullscreen": "Vollbild",
  "terminal.exit_fullscreen": "Vollbild verlassen",
  "terminal.exited": "Prozess mit Code {code} beendet",
  "terminal.resize": "Zum Anpassen ziehen",
  "terminal.start_failed": "Das Terminal konnte nicht starten",
  "terminal.tabs": "Terminal-Tabs",
};
