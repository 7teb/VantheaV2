import { randomUUID } from "node:crypto";
import { as_array, as_iso, as_number, as_record, as_string, pick } from "../storage/coerce.ts";
import { path_key } from "../storage/paths.ts";
import { clean_text, memory_kinds, memory_text_chars, normalize_memory_key, redact_secrets, words_for, type MemoryKind } from "./text.ts";

export type MemoryStatus = "pending" | "confirmed" | "rejected";

export type MemoryEntry = {
  id: string;
  key: string;
  kind: MemoryKind;
  scope: "global" | "project";
  project_path: string;
  text: string;
  evidence: string;
  confidence: number;
  status: MemoryStatus;
  source_chat_id: string;
  source_message_id: string;
  created_at: string;
  updated_at: string;
};

export type MemoryState = { records: MemoryEntry[] };

export const high_confidence = 0.85;

const statuses: readonly MemoryStatus[] = ["pending", "confirmed", "rejected"];

const kind_scores: Record<MemoryKind, number> = { global_preference: 2, global_environment: 1, project_rule: 0 };

const max_rejected = 500;

export const empty_state = (): MemoryState => ({ records: [] });

export const new_memory_id = () => `mem-${randomUUID()}`;

const confidence_of = (value: unknown) => Math.max(0, Math.min(1, as_number(Number(value), 0)));

export const normalize_entry = (value: unknown, now: string): MemoryEntry | null => {
  const raw = as_record(value);
  const kind = pick(raw.kind, memory_kinds, "global_preference");
  const text = redact_secrets(raw.text, memory_text_chars);
  if (!text) {
    return null;
  }
  const scope = raw.scope === "project" || kind === "project_rule" ? "project" : "global";
  return {
    id: clean_text(raw.id, 180) || new_memory_id(),
    key: normalize_memory_key(raw.key, kind, text),
    kind,
    scope,
    project_path: scope === "project" ? path_key(as_string(raw.project_path)) : "",
    text,
    evidence: redact_secrets(raw.evidence, memory_text_chars),
    confidence: confidence_of(raw.confidence),
    status: pick(raw.status, statuses, "pending"),
    source_chat_id: clean_text(raw.source_chat_id, 160),
    source_message_id: clean_text(raw.source_message_id, 160),
    created_at: as_iso(raw.created_at, now),
    updated_at: as_iso(raw.updated_at, now),
  };
};

export const parse_state = (value: unknown, now: string): MemoryState | null => {
  const raw = as_record(value);
  if (raw.version !== 1 || !Array.isArray(raw.records)) {
    return null;
  }
  return { records: raw.records.flatMap((entry) => normalize_entry(entry, now) ?? []) };
};

export const convert_legacy_state = (value: unknown, now: string): MemoryState | null => {
  const raw = as_record(value);
  if (raw.version !== 2 || !Array.isArray(raw.records)) {
    return null;
  }
  const records = as_array(raw.records).flatMap((entry) => {
    const legacy = as_record(entry);
    const converted = normalize_entry(
      {
        ...legacy,
        project_path: legacy.projectPath,
        source_chat_id: legacy.sourceChatId,
        source_message_id: legacy.sourceMessageId,
        created_at: legacy.createdAt,
        updated_at: legacy.updatedAt,
      },
      now,
    );
    return converted ? [converted] : [];
  });
  return { records };
};

export const compact_state = (state: MemoryState): MemoryState => {
  const active = state.records.filter((entry) => entry.status !== "rejected");
  const rejected = state.records.filter((entry) => entry.status === "rejected").slice(-max_rejected);
  return { records: [...active, ...rejected] };
};

export const same_scope = (left: MemoryEntry, right: MemoryEntry) =>
  left.scope === right.scope && (left.scope !== "project" || left.project_path === right.project_path);

export const relevance = (entry: MemoryEntry, query: Set<string>, project: string): number => {
  const words = words_for(`${entry.key} ${entry.text}`);
  let overlap = 0;
  for (const word of query) {
    if (words.has(word)) {
      overlap += 1;
    }
  }
  const project_score = entry.scope === "project" && entry.project_path === project ? 12 : 0;
  return project_score + kind_scores[entry.kind] + overlap * 4;
};
