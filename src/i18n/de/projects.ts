import type { projects as en } from "../en/projects.ts";

export const projects: Record<keyof typeof en, string> = {
  "projects.choose": "Projekt wählen",
  "projects.search": "Projekt suchen",
  "projects.none": "Keine Projekte",
  "projects.options": "Projekt-Optionen",
  "projects.delete": "Projekt löschen",
  "projects.delete_confirm": "Wirklich löschen?",
  "projects.delete_confirm_chats": "Wirklich löschen, mit {n} Chats?",
  "projects.add": "Projekt hinzufügen",
  "projects.create": "Projekt erstellen",
  "projects.add_existing": "Vorhandenen Ordner hinzufügen",
  "projects.without": "Ohne Projekt arbeiten",
  "projects.rename_label": "Projektname",
  "projects.delete_title": "Dieses Projekt löschen?",
  "projects.new_chat": "Neuer Chat in diesem Projekt",
};
