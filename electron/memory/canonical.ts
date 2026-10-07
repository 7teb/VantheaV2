import { as_record, error_text } from "../storage/coerce.ts";
import type { SideModelCall } from "../tools/types.ts";
import { known_text } from "./extract.ts";
import type { KnownMemory } from "./store.ts";
import { clean_text, memory_kinds, type MemoryKind } from "./text.ts";

export type CanonicalMemory = { kind: MemoryKind; key: string; text: string };

const canonical_timeout_ms = 20000;

const canonical_prompt = `Canonicalize one memory that the user explicitly asked to save. Output ONLY one JSON object with kind, key, text, evidence, confidence and explicit. kind must be global_preference, global_environment or project_rule. Use project_rule only when it applies solely to the current project. Prefer an existing canonical key for the same fact. Otherwise create one under communication.*, coding.*, environment.*, tooling.*, workflow.* or project.*. Keep text neutral, concise and in English. Set evidence to the proposed memory text, confidence to 1 and explicit to true. Never include a secret.`;

export const parse_canonical = (raw: string, fallback_text: string): CanonicalMemory => {
  const found = raw.match(/\{[\s\S]*\}/);
  const parsed = as_record(JSON.parse(found ? found[0] : raw));
  return {
    kind: memory_kinds.find((kind) => kind === parsed.kind) ?? "global_preference",
    key: clean_text(parsed.key, 160),
    text: clean_text(parsed.text, 500) || fallback_text,
  };
};

export const canonicalize_memory = async (
  text: string,
  known: KnownMemory[],
  side_model: SideModelCall,
  signal: AbortSignal,
): Promise<CanonicalMemory> => {
  try {
    const raw = await side_model(
      "memory",
      [
        { role: "system", content: canonical_prompt },
        { role: "user", content: `EXISTING CANONICAL MEMORIES:\n${known_text(known) || "(none)"}\n\nPROPOSED MEMORY:\n${text.slice(0, 1000)}` },
      ],
      800,
      AbortSignal.any([signal, AbortSignal.timeout(canonical_timeout_ms)]),
    );
    return parse_canonical(raw, text);
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    console.warn(`[memory] canonicalizing "${text.slice(0, 80)}" failed, saving it as written: ${error_text(error)}`);
    return { kind: "global_preference", key: "", text };
  }
};
