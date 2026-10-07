import type { status as en } from "../en/status.ts";

export const status: Record<keyof typeof en, string> = {
  "status.reverted": "Änderungen rückgängig gemacht",
  "status.ready": "Bereit",
  "status.indexing": "Projekt wird indexiert",
  "status.approved": "Freigegeben, arbeite…",
  "status.denied": "Abgelehnt",
  "status.failed": "Anfrage fehlgeschlagen",
  "status.retrying": "Antwort unterbrochen, Versuch {n}/{total}",
  "status.interrupted": "Antwort unterbrochen",
  "status.saved": "Einstellungen gespeichert",
  "status.no_vision": "Gewähltes Modell unterstützt keine Bilder",
  "status.select_attachment": "Bild oder Textdatei auswählen",
  "status.file_too_large": "{name} ist größer als 2 MB",
  "status.max_images": "Du kannst höchstens {n} Dateien anhängen",
  "status.analyzing_image": "Bild wird analysiert...",
  "status.stopped": "Gestoppt",
};
