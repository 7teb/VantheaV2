import type { plan as en } from "../en/plan.ts";

export const plan: Record<keyof typeof en, string> = {
  "plan.title": "Plan",
  "plan.key_changes": "Wichtige Änderungen",
  "plan.files": "Dateien",
  "plan.test_plan": "Testplan",
  "plan.assumptions": "Annahmen",
  "plan.implementing": "Plan wird implementiert…",
  "plan.accepted": "Übernommen",
  "plan.rejected": "Plan verworfen. Sag mir, was anders soll.",
  "plan.question": "Diesen Plan implementieren?",
  "plan.no": "Nein",
  "plan.yes": "Ja, implementieren",
  "plan.blocked_title": "Vom Planmodus blockiert ({tool})",
  "plan.blocked_with_plan": "Der Planmodus ist read-only, es wurde nichts geändert. Nimm den Plan oben an, damit die Arbeit startet, oder schalte den Planmodus im +-Menü aus.",
  "plan.blocked_no_plan": "Der Planmodus ist read-only, es wurde nichts geändert. Lass erst einen Plan präsentieren, den du annehmen kannst, oder schalte den Planmodus im +-Menü aus.",
};
