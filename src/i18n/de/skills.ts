import type { skills as en } from "../en/skills.ts";

export const skills: Record<keyof typeof en, string> = {
  "skills.title": "Skills",
  "skills.folder": "Skill-Ordner",
  "skills.open": "Ordner öffnen",
  "skills.reload": "Neu einlesen",
  "skills.remove": "Entfernen",
  "skills.remove_confirm": "Skill \"{x}\" entfernen? Der Ordner wird gelöscht.",
  "skills.source": "Quelle",
  "skills.local": "lokal",
  "skills.view": "SKILL.md anzeigen",
  "skills.hide": "SKILL.md ausblenden",
  "skills.broken": "Nicht ladbar: {x}",
  "skills.files": "{n} weitere Dateien",
  "skills.empty": "Keine Skills installiert",
  "skills.enable": "{x} aktivieren",
  "skills.folder_sub": "Jeder Skill ist ein Ordner mit einer SKILL.md",
  "skills.load_failed": "Skills konnten nicht geladen werden",
};
