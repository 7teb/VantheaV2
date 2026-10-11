import type { questions as en } from "../en/questions.ts";

export const questions: Record<keyof typeof en, string> = {
  "questions.header": "Frage",
  "questions.count": "{n} von {total}",
  "questions.previous": "Vorherige Frage",
  "questions.next_question": "Nächste Frage",
  "questions.next": "Weiter",
  "questions.send": "Senden",
  "questions.other": "Oder eigene Antwort schreiben",
  "questions.reply": "Antworten…",
  "questions.send_failed": "Antwort konnte nicht gesendet werden: {x}",
  "questions.dismiss_failed": "Frage konnte nicht verworfen werden: {x}",
};
