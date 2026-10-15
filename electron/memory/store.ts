import type { MemoryRecord, MemoryReviewItem } from "../../shared/ipc/extensions.ts";
import { keep_corrupt, read_json, write_json } from "../storage/json-file.ts";
import { path_key } from "../storage/paths.ts";
import {
  compact_state,
  convert_legacy_state,
  empty_state,
  high_confidence,
  normalize_entry,
  parse_state,
  relevance,
  same_scope,
  new_memory_id,
  sanitize_candidate,
  type MemoryEntry,
  type MemorySource,
  type MemoryState,
  type ScanCounts,
} from "./records.ts";
import { clean_text, manual_memory_key, memory_handle, memory_text_chars, similarity, words_for } from "./text.ts";

export type MemoryFiles = { file: string; legacy_file: string };

export type KnownMemory = { key: string; scope: MemoryEntry["scope"]; text: string };

export type ScanEpoch = { forgotten: number; resets: number };

const max_candidates = 3;

const similar_threshold = 0.76;

let files: MemoryFiles | null = null;
let state: MemoryState = empty_state();

const forgotten = new Map<string, number>();
let resets = 0;

const memory_file = (): string => {
  if (!files) {
    throw new Error("memory store used before init_memory");
  }
  return files.file;
};

const write_state = (file: string) => {
  state = compact_state(state);
  return write_json(file, { version: 1, records: state.records, scans: state.scans });
};

const persist = () => write_state(memory_file());

const import_legacy = async (legacy_file: string, now: string): Promise<MemoryState> => {
  const legacy = await read_json(legacy_file);
  if (legacy.status === "missing") {
    return empty_state();
  }
  if (legacy.status === "corrupt") {
    console.error(`[memory] legacy ${legacy_file} is not valid JSON (${legacy.error}), no memories imported`);
    return empty_state();
  }
  const converted = convert_legacy_state(legacy.value, now);
  if (!converted) {
    console.error(`[memory] legacy ${legacy_file} is not a version 2 memory file, no memories imported`);
    return empty_state();
  }
  console.info(`[memory] imported ${converted.records.length} memories from ${legacy_file}`);
  return converted;
};

const confirm_waiting = async (now: string) => {
  const ready = state.records.filter((entry) => entry.status === "pending" && entry.confidence >= high_confidence && !rejected_before(entry));
  if (!ready.length) {
    return;
  }
  for (const entry of ready) {
    confirm_into({ ...entry, status: "confirmed", updated_at: now }, entry.id);
  }
  try {
    await persist();
    console.info(`[memory] saved ${ready.length} memory candidates with high confidence that were waiting for review`);
  } catch (error) {
    console.error(`[memory] saving ${ready.length} confirmed memory candidates to ${memory_file()} failed:`, error);
  }
};

export const init_memory = async (options: MemoryFiles) => {
  files = null;
  state = empty_state();
  const now = new Date().toISOString();
  const stored = await read_json(options.file);
  const parsed = stored.status === "ok" ? parse_state(stored.value, now) : null;
  if (parsed) {
    state = parsed;
    files = options;
    await confirm_waiting(now);
    return;
  }
  if (stored.status === "ok") {
    console.error(`[memory] ${options.file} is not a version 1 memory file, keeping a copy at ${await keep_corrupt(options.file)}`);
  }
  if (stored.status === "corrupt") {
    console.error(`[memory] ${options.file} is not valid JSON (${stored.error}), keeping a copy at ${await keep_corrupt(options.file)}`);
  }
  state = stored.status === "missing" ? await import_legacy(options.legacy_file, now) : empty_state();
  await write_state(options.file);
  files = options;
  await confirm_waiting(now);
};

export const memory_loaded = (): boolean => files !== null;

export const known_memories = (): KnownMemory[] =>
  state.records
    .filter((entry) => entry.status !== "rejected")
    .slice(0, 200)
    .map((entry) => ({ key: entry.key, scope: entry.scope, text: entry.text }));

export const is_scanned = (message_id: string): boolean => Object.hasOwn(state.scans, clean_text(message_id, 160));

export const scan_epoch = (message_id: string): ScanEpoch => ({ forgotten: forgotten.get(clean_text(message_id, 160)) ?? 0, resets });

const epoch_changed = (message_id: string, epoch: ScanEpoch): boolean => (forgotten.get(message_id) ?? 0) !== epoch.forgotten || resets !== epoch.resets;

export const forget_scan = async (message_id: string): Promise<void> => {
  const id = clean_text(message_id, 160);
  forgotten.set(id, (forgotten.get(id) ?? 0) + 1);
  if (!Object.hasOwn(state.scans, id)) {
    return;
  }
  state.scans = Object.fromEntries(Object.entries(state.scans).filter(([key]) => key !== id));
  await persist();
};

const matching_key = (active: MemoryEntry[], candidate: MemoryEntry): string => {
  if (active.some((entry) => entry.key === candidate.key)) {
    return candidate.key;
  }
  const similar = active
    .map((entry) => ({ entry, score: similarity(entry.text, candidate.text) }))
    .sort((a, b) => b.score - a.score)[0];
  return similar && similar.score >= similar_threshold ? similar.entry.key : candidate.key;
};

const rejected_before = (candidate: MemoryEntry): boolean =>
  state.records.some((entry) => entry.status === "rejected" && same_scope(entry, candidate) && similarity(entry.text, candidate.text) >= similar_threshold);

const hold_for_review = (candidate: MemoryEntry) => {
  const pending = state.records.find((entry) => entry.status === "pending" && same_scope(entry, candidate) && entry.key === candidate.key);
  state.records = pending
    ? state.records.map((entry) => (entry === pending ? { ...candidate, id: pending.id, created_at: pending.created_at } : entry))
    : [...state.records, candidate];
};

const keep_candidate = (candidate: MemoryEntry): "saved" | "pending" => {
  const active = state.records.filter((entry) => entry.status !== "rejected" && same_scope(entry, candidate));
  const next = { ...candidate, key: matching_key(active, candidate) };
  if (rejected_before(next)) {
    hold_for_review(next);
    return "pending";
  }
  const pending = active.find((entry) => entry.status === "pending" && entry.key === next.key);
  const saved: MemoryEntry = pending ? { ...next, id: pending.id, created_at: pending.created_at, status: "confirmed" } : { ...next, status: "confirmed" };
  confirm_into(saved, pending?.id ?? null);
  return "saved";
};

export const store_scan_result = async (source: MemorySource, candidates: unknown[], outcome: string, error = "", epoch: ScanEpoch | null = null): Promise<ScanCounts> => {
  const message_id = clean_text(source.message_id, 160);
  if (!message_id || is_scanned(message_id) || (epoch && epoch_changed(message_id, epoch))) {
    return { returned: 0, saved: 0, pending: 0, dropped: {} };
  }
  const considered = candidates.slice(0, max_candidates);
  const counts: ScanCounts = { returned: considered.length, saved: 0, pending: 0, dropped: {} };
  const now = new Date().toISOString();
  for (const raw of considered) {
    const verdict = sanitize_candidate(raw, source, now);
    if (verdict.drop) {
      counts.dropped[verdict.drop] = (counts.dropped[verdict.drop] ?? 0) + 1;
      continue;
    }
    counts[keep_candidate(verdict.entry)] += 1;
  }
  state.scans = { ...state.scans, [message_id]: { scanned_at: now, outcome, counts, ...(error ? { error: clean_text(error, 300) } : {}) } };
  await persist();
  return counts;
};

const confirmed = (): MemoryEntry[] =>
  state.records.filter((entry) => entry.status === "confirmed").sort((a, b) => b.updated_at.localeCompare(a.updated_at));

const confirm_into = (candidate: MemoryEntry, replaced_id: string | null): MemoryEntry => {
  const exact = state.records.find(
    (entry) => entry.id !== replaced_id && entry.status === "confirmed" && entry.key === candidate.key && same_scope(entry, candidate),
  );
  if (exact) {
    const merged = { ...candidate, id: exact.id, created_at: exact.created_at };
    state.records = state.records.filter((entry) => entry.id !== replaced_id).map((entry) => (entry === exact ? merged : entry));
    return merged;
  }
  const present = replaced_id !== null && state.records.some((entry) => entry.id === replaced_id);
  state.records = present ? state.records.map((entry) => (entry.id === replaced_id ? candidate : entry)) : [...state.records, candidate];
  return candidate;
};

export const confirm_memory = async (draft: MemoryEntry): Promise<MemoryEntry> => {
  const now = new Date().toISOString();
  const candidate = normalize_entry({ ...draft, status: "confirmed", updated_at: now }, now);
  if (!candidate) {
    throw new Error("memory text is empty after removing secrets");
  }
  const saved = confirm_into(candidate, null);
  await persist();
  return saved;
};

export const add_memory = async (value: string): Promise<MemoryEntry> => {
  const text = value.trim();
  if (!text) {
    throw new Error("memory text is empty");
  }
  if (text.length > memory_text_chars) {
    throw new Error(`memory text is ${text.length} characters, over the ${memory_text_chars}-character limit for one memory`);
  }
  const now = new Date().toISOString();
  return confirm_memory({
    id: new_memory_id(),
    key: manual_memory_key("global_preference", text),
    kind: "global_preference",
    scope: "global",
    project_path: "",
    text,
    evidence: text,
    confidence: 1,
    status: "confirmed",
    source_chat_id: "",
    source_message_id: "",
    created_at: now,
    updated_at: now,
  });
};

export const review_items = (): MemoryReviewItem[] =>
  state.records
    .filter((entry) => entry.status === "pending")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 100)
    .map((entry) => ({ id: entry.id, text: entry.text, reason: entry.evidence }));

export const resolve_pending = async (id: string, action: "keep" | "discard"): Promise<void> => {
  const pending = state.records.find((entry) => entry.id === id && entry.status === "pending");
  if (!pending) {
    throw new Error(`memory candidate ${id.slice(0, 80)} is not pending review`);
  }
  const now = new Date().toISOString();
  if (action === "discard") {
    state.records = state.records.map((entry) => (entry === pending ? { ...entry, status: "rejected" as const, updated_at: now } : entry));
  } else {
    confirm_into({ ...pending, status: "confirmed", updated_at: now }, pending.id);
  }
  await persist();
};

export const confirmed_memories = (): MemoryEntry[] => confirmed();

export const memory_records = (): MemoryRecord[] =>
  confirmed().map((entry) => ({ id: entry.id, text: entry.text, project_path: entry.project_path, created_at: entry.created_at }));

export const find_confirmed = (wanted: string): MemoryEntry | null => {
  const value = clean_text(wanted, memory_text_chars).toLowerCase();
  const list = confirmed();
  return (
    list.find((entry) => entry.id.toLowerCase() === value) ??
    list.find((entry) => memory_handle(entry.id).toLowerCase() === value) ??
    list.find((entry) => entry.text.toLowerCase() === value) ??
    null
  );
};

export const remove_memory = async (id: string): Promise<boolean> => {
  const before = state.records.length;
  state.records = state.records.filter((entry) => entry.id !== id);
  if (state.records.length === before) {
    return false;
  }
  await persist();
  return true;
};

export const move_project_memories = async (old_path: string, next_path: string): Promise<void> => {
  const key = path_key(old_path);
  if (!state.records.some((entry) => entry.project_path === key)) {
    return;
  }
  const next = path_key(next_path);
  state.records = state.records.map((entry) => (entry.project_path === key ? { ...entry, project_path: next } : entry));
  await persist();
};

export const reset_memories = async () => {
  resets += 1;
  state = empty_state();
  await persist();
};

const in_scope = (project: string): MemoryEntry[] => confirmed().filter((entry) => entry.scope === "global" || (project !== "" && entry.project_path === project));

export const memory_count = (project_path: string): number => in_scope(path_key(project_path)).length;

export const retrieve_memories = (project_path: string, query: string, limit: number): MemoryEntry[] => {
  const project = path_key(project_path);
  const words = words_for(query);
  return in_scope(project)
    .map((entry) => ({ entry, score: relevance(entry, words, project) }))
    .sort((a, b) => b.score - a.score || b.entry.updated_at.localeCompare(a.entry.updated_at))
    .slice(0, limit)
    .map((item) => item.entry);
};
