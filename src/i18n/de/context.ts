import type { context as en } from "../en/context.ts";

export const context: Record<keyof typeof en, string> = {
  "context.title": "Kontext-Auslastung",
  "context.total": "Gesamt-Kontext",
  "context.cat_system": "System-Prompt",
  "context.cat_tools": "Tools",
  "context.cat_mcp": "MCP",
  "context.cat_messages": "Nachrichten",
  "context.cat_code": "Code (gelesen)",
  "context.compact": "Komprimieren",
  "context.compact_queued": "Komprimiert nach diesem Turn",
  "context.compressing": "Kontext wird komprimiert",
  "context.compacted_here": "Frühere Nachrichten komprimiert",
  "context.compaction_failed": "Kontext-Komprimierung fehlgeschlagen",
  "context.compact_now": "Jetzt komprimieren",
  "context.auto_note": "Komprimiert von selbst, sobald ein Chat 80 % des Modellfensters überschreitet. Die letzten drei Wechsel bleiben immer vollständig.",
  "context.compact_done": "Frühere Nachrichten wurden zusammengefasst.",
  "context.compact_nothing": "Noch nichts zu komprimieren. Die letzten drei Wechsel bleiben immer vollständig.",
  "context.compact_busy": "Warte, bis der laufende Turn fertig ist.",
};
