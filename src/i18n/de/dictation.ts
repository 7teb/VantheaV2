import type { dictation as en } from "../en/dictation.ts";

export const dictation: Record<keyof typeof en, string> = {
  "dictation.dictate": "Diktieren",
  "dictation.starting": "Diktat startet, Klick bricht ab",
  "dictation.stop": "Diktat beenden",
  "dictation.transcribing": "Wird transkribiert",
  "dictation.denied": "Erlaube den Mikrofonzugriff, um zu diktieren",
  "dictation.no_microphone": "Schließe ein Mikrofon an, um zu diktieren",
  "dictation.microphone_busy": "Schließe andere Apps, die das Mikrofon nutzen",
  "dictation.microphone_failed": "Das Mikrofon ließ sich nicht öffnen: {error}",
  "dictation.nothing_heard": "Nichts verstanden, bitte noch mal versuchen",
  "dictation.failed": "Transkription fehlgeschlagen: {error}",
};
