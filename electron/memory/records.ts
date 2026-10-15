import { randomUUID } from "node:crypto";
import { as_array, as_iso, as_number, as_record, as_string, clamp_int, pick } from "../storage/coerce.ts";
import { path_key } from "../storage/paths.ts";
import { clean_text, contains_secret, memory_kinds, memory_text_chars, normalize_memory_key, redact_secrets, words_for, type MemoryKind } from "./text.ts";

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

export type DropReason = "kind" | "empty" | "not_explicit" | "secret" | "evidence_not_in_message" | "low_confidence" | "no_project";

export type ScanCounts = { returned: number; saved: number; pending: number; dropped: Partial<Record<DropReason, number>> };

export type MemoryScan = { scanned_at: string; outcome: string; counts?: ScanCounts; error?: string };

export type MemoryState = { records: MemoryEntry[]; scans: Record<string, MemoryScan> };

export type MemorySource = { chat_id: string; message_id: string; content: string; project_path: string };

export type CandidateVerdict = { entry: MemoryEntry; drop: null } | { entry: null; drop: DropReason };

export const high_confidence = 0.85;

const statuses: readonly MemoryStatus[] = ["pending", "confirmed", "rejected"];

const drop_reasons: readonly DropReason[] = ["kind", "empty", "not_explicit", "secret", "evidence_not_in_message", "low_confidence", "no_project"];

const kind_scores: Record<MemoryKind, number> = { global_preference: 2, global_environment: 1, project_rule: 0 };

const max_rejected = 500;

const max_scans = 5000;

export const empty_state = (): MemoryState => ({ records: [], scans: {} });

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

const count_of = (value: unknown) => clamp_int(value, 0, 1000, 0);

const normalize_counts = (value: unknown): ScanCounts | null => {
  if (value === undefined) {
    return null;
  }
  const raw = as_record(value);
  const dropped = as_record(raw.dropped);
  return {
    returned: count_of(raw.returned),
    saved: count_of(raw.saved),
    pending: count_of(raw.pending),
    dropped: Object.fromEntries(drop_reasons.map((reason) => [reason, count_of(dropped[reason])]).filter(([, count]) => count)),
  };
};

const normalize_scan = (scan: unknown, now: string): MemoryScan => {
  const raw = as_record(scan);
  const counts = normalize_counts(raw.counts);
  const error = clean_text(raw.error, 300);
  return {
    scanned_at: as_iso(raw.scanned_at, now),
    outcome: clean_text(raw.outcome, 40) || "scanned",
    ...(counts ? { counts } : {}),
    ...(error ? { error } : {}),
  };
};

const normalize_scans = (value: unknown, now: string): Record<string, MemoryScan> =>
  Object.fromEntries(Object.entries(as_record(value)).map(([id, scan]) => [id.slice(0, 160), normalize_scan(scan, now)]));

export const parse_state = (value: unknown, now: string): MemoryState | null => {
  const raw = as_record(value);
  if (raw.version !== 1 || !Array.isArray(raw.records)) {
    return null;
  }
  return { records: raw.records.flatMap((entry) => normalize_entry(entry, now) ?? []), scans: normalize_scans(raw.scans, now) };
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
  const scans = Object.fromEntries(
    Object.entries(as_record(raw.scans)).map(([id, scan]) => [id, { scanned_at: as_record(scan).scannedAt, outcome: as_record(scan).outcome }]),
  );
  return { records, scans: normalize_scans(scans, now) };
};

export const compact_state = (state: MemoryState): MemoryState => {
  const active = state.records.filter((entry) => entry.status !== "rejected");
  const rejected = state.records.filter((entry) => entry.status === "rejected").slice(-max_rejected);
  const scans = Object.entries(state.scans)
    .sort((a, b) => b[1].scanned_at.localeCompare(a[1].scanned_at))
    .slice(0, max_scans);
  return { records: [...active, ...rejected], scans: Object.fromEntries(scans) };
};

export const same_scope = (left: MemoryEntry, right: MemoryEntry) =>
  left.scope === right.scope && (left.scope !== "project" || left.project_path === right.project_path);

const drop_verdict = (drop: DropReason): CandidateVerdict => ({ entry: null, drop });

export const sanitize_candidate = (candidate: unknown, source: MemorySource, now: string): CandidateVerdict => {
  const raw = as_record(candidate);
  const kind = memory_kinds.find((entry) => entry === raw.kind);
  const text = clean_text(raw.text, memory_text_chars);
  const evidence = clean_text(raw.evidence, memory_text_chars);
  if (!kind) {
    return drop_verdict("kind");
  }
  if (!text || !evidence) {
    return drop_verdict("empty");
  }
  if (raw.explicit !== true) {
    return drop_verdict("not_explicit");
  }
  if (contains_secret(text) || contains_secret(evidence)) {
    return drop_verdict("secret");
  }
  const source_text = clean_text(source.content, Number.POSITIVE_INFINITY).toLowerCase();
  if (!source_text.includes(evidence.toLowerCase())) {
    return drop_verdict("evidence_not_in_message");
  }
  const confidence = confidence_of(raw.confidence);
  if (confidence < high_confidence) {
    return drop_verdict("low_confidence");
  }
  const scope = kind === "project_rule" ? "project" : "global";
  const project_path = scope === "project" ? path_key(source.project_path) : "";
  if (scope === "project" && !project_path) {
    return drop_verdict("no_project");
  }
  const entry: MemoryEntry = {
    id: new_memory_id(),
    key: normalize_memory_key(raw.key, kind, text),
    kind,
    scope,
    project_path,
    text,
    evidence: redact_secrets(evidence),
    confidence,
    status: "pending",
    source_chat_id: clean_text(source.chat_id, 160),
    source_message_id: clean_text(source.message_id, 160),
    created_at: now,
    updated_at: now,
  };
  return { entry, drop: null };
};

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
