import type { privacy as en } from "../en/privacy.ts";

export const privacy: Record<keyof typeof en, string> = {
  "privacy.group": "Chats und Projekte",
  "privacy.archive_chats": "Alle Chats archivieren",
  "privacy.archive_chats_sub": "Verschiebt jeden Chat ins Archiv, wo du ihn weiter öffnen oder wiederherstellen kannst. Chats mit laufendem Turn bleiben.",
  "privacy.archive_chats_btn": "Alle archivieren",
  "privacy.archive_chats_title": "Alle Chats archivieren?",
  "privacy.archived": "Archivierte Chats: {n}",
  "privacy.archived_skipped": "Archivierte Chats: {n}, ausgelassen, weil sie noch laufen: {skipped}",
  "privacy.delete_chats": "Alle Chats löschen",
  "privacy.delete_chats_sub": "Löscht jeden Chat, auch archivierte, mit seinen Anhängen. Das lässt sich nicht rückgängig machen.",
  "privacy.delete_chats_btn": "Alle löschen",
  "privacy.delete_chats_title": "Alle Chats löschen?",
  "privacy.deleted": "Gelöschte Chats: {n}",
  "privacy.remove_projects": "Alle Projekte entfernen",
  "privacy.remove_projects_sub": "Entfernt jedes Projekt aus VantheaX und löscht seine Chats. Die Ordner auf der Festplatte bleiben unberührt.",
  "privacy.remove_projects_btn": "Alle entfernen",
  "privacy.remove_projects_title": "Alle Projekte entfernen?",
  "privacy.removed": "Entfernte Projekte: {n}",
};
