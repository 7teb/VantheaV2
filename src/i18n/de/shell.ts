import type { shell as en } from "../en/shell.ts";

export const shell: Record<keyof typeof en, string> = {
  "shell.sidebar_open": "Sidebar öffnen",
  "shell.sidebar_close": "Sidebar schließen",
  "shell.back": "Zurück",
  "shell.forward": "Vorwärts",
  "shell.window_minimize": "Minimieren",
  "shell.window_maximize": "Maximieren",
  "shell.window_restore": "Wiederherstellen",
  "shell.window_close": "Schließen",
  "shell.hero_generic": "Woran arbeiten wir?",
  "shell.hero_project": "Woran arbeiten wir in {name}?",
  "shell.dock_resize": "Ziehen zum Anpassen",
};
