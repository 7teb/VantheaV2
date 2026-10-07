import type { sidebar as en } from "../en/sidebar.ts";

export const sidebar: Record<keyof typeof en, string> = {
  "sidebar.new_chat": "Neuer Chat",
  "sidebar.search": "Suche",
  "sidebar.open_project": "Projekt öffnen",
  "sidebar.settings": "Einstellungen",
  "sidebar.projects": "Projekte",
  "sidebar.no_project": "Kein Projekt",
  "sidebar.no_chats": "Keine Chats",
  "sidebar.show_chats": "Chats anzeigen",
  "sidebar.hide_chats": "Chats ausblenden",
  "sidebar.chat_options": "Chat-Optionen",
  "sidebar.rename": "Umbenennen",
  "sidebar.pin": "Anpinnen",
  "sidebar.unpin": "Lösen",
  "sidebar.delete": "Löschen",
  "sidebar.load_failed": "Chats konnten nicht geladen werden",
  "sidebar.navigation": "Chats und Projekte",
  "sidebar.pinned": "Angepinnt",
  "sidebar.working": "Arbeitet",
  "sidebar.delete_title": "Diesen Chat löschen?",
  "sidebar.rename_label": "Chat-Titel",
};
