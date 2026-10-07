import type { image as en } from "../en/image.ts";

export const image: Record<keyof typeof en, string> = {
  "image.generating": "Bild wird generiert",
  "image.editing": "Bild wird bearbeitet",
  "image.done": "Generiert mit {model}",
  "image.failed": "Bildgenerierung fehlgeschlagen",
  "image.enable": "Bildgenerierung aktivieren",
  "image.enable_sub": "Das Modell kann auf Anfrage Bilder mit einem eigenen Bildmodell generieren und bearbeiten",
  "image.model": "Bildmodell",
  "image.model_sub": "Läuft über deinen OpenRouter-Key",
  "image.quality": "Qualität",
  "image.download": "Bild herunterladen",
  "image.q_auto": "Auto",
  "image.q_low": "Niedrig",
  "image.q_medium": "Mittel",
  "image.q_high": "Hoch",
  "image.catalog_failed": "Bildmodelle konnten nicht geladen werden",
};
