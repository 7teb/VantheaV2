import type { background as en } from "../en/background.ts";

export const background: Record<keyof typeof en, string> = {
  "background.title": "Background Tasks",
  "background.none": "Keine Background Tasks in diesem Chat",
  "background.clear_finished": "Beendete Befehle entfernen",
  "background.section_running": "Läuft",
  "background.section_finished": "Beendet",
  "background.cancel": "Task abbrechen",
  "background.close": "Background Tasks schließen",
  "background.fullscreen": "Vollbild",
  "background.exit_fullscreen": "Vollbild verlassen",
  "background.started": "Background Task gestartet",
  "background.running_status": "Läuft",
  "background.completed": "Abgeschlossen",
  "background.failed": "Fehlgeschlagen",
  "background.canceled": "Abgebrochen",
  "background.interrupted": "Unterbrochen",
  "background.process": "Prozess",
  "background.exit_code": "Exit {code}",
  "background.load_failed": "Background Tasks konnten nicht geladen werden",
  "background.output": "Ausgabe",
};
