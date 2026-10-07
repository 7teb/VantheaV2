import type { MemoryRecord, MemoryReviewItem } from "../../shared/ipc/extensions.ts";
import { keep_corrupt, read_json, write_json } from "../storage/json-file.ts";
import { path_key } from "../storage/paths.ts";
import {
  compact_state,
  convert_legacy_state,
  empty_state,
  normalize_entry,
  parse_state,
  relevance,
  same_scope,
  sanitize_candidate,
  type MemoryEntry,
  type MemorySource,
  type MemoryState,
} from "./records.ts";
import { clean_text, memory_handle, similarity, words_for } from "./text.ts";

export type MemoryFiles = { file: string; legacy_file: string };

export type KnownMemory = { key: string; scope: MemoryEntry["scope"]; text: string };

const max_candidates = 3;

const similar_threshold = 0.76;

let files: MemoryFiles | null = null;
let state: MemoryState = empty_state();

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

export const init_memory = async (options: MemoryFiles) => {
  files = null;
  state = empty_state();
  const now = new Date().toISOString();
  const stored = await read_json(options.file);
  const parsed = stored.status === "ok" ? parse_state(stored.value, now) : null;
  if (parsed) {
    state = parsed;
    files = options;
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
};

export const memory_loaded = (): boolean => files !== null;

export const known_memories = (): KnownMemory[] =>
  state.records
    .filter((entry) => entry.status !== "rejected")
    .slice(0, 200)
    .map((entry) => ({ key: entry.key, scope: entry.scope, text: entry.text }));

export const is_scanned = (message_id: string): boolean => Object.hasOwn(state.scans, clean_text(message_id, 160));

const merge_candidate = (candidate: MemoryEntry): boolean => {
  const comparable = state.records.filter((entry) => entry.status !== "rejected" && same_scope(entry, candidate));
  const exact = comparable.some((entry) => entry.key === candidate.key);
  const similar = comparable
    .map((entry) => ({ entry, score: similarity(entry.text, candidate.text) }))
    .sort((a, b) => b.score - a.score)[0];
  const key = !exact && similar && similar.score >= similar_threshold ? similar.entry.key : candidate.key;
  const next = { ...candidate, key };
  const pending = comparable.find((entry) => entry.status === "pending" && entry.key === key);
  if (pending) {
    state.records = state.records.map((entry) =>
      entry === pending ? { ...next, id: pending.id, created_at: pending.created_at } : entry,
    );
    return false;
  }
  state.records = [...state.records, next];
  return true;
};

export const store_scan_result = async (source: MemorySource, candidates: unknown[], outcome: string): Promise<number> => {
  const message_id = clean_text(source.message_id, 160);
  if (!message_id || is_scanned(message_id)) {
    return 0;
  }
  const now = new Date().toISOString();
  let added = 0;
  for (const raw of candidates.slice(0, max_candidates)) {
    const candidate = sanitize_candidate(raw, source, now);
    if (candidate && merge_candidate(candidate)) {
      added += 1;
    }
  }
  state.scans = { ...state.scans, [message_id]: { scanned_at: now, outcome } };
  await persist();
  return added;
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
  const value = clean_text(wanted, 500).toLowerCase();
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
  state = empty_state();
  await persist();
};

export const retrieve_memories = (project_path: string, query: string, limit: number): MemoryEntry[] => {
  const project = path_key(project_path);
  const words = words_for(query);
  return confirmed()
    .filter((entry) => entry.scope === "global" || (project !== "" && entry.project_path === project))
    .map((entry) => ({ entry, score: relevance(entry, words, project) }))
    .sort((a, b) => b.score - a.score || b.entry.updated_at.localeCompare(a.entry.updated_at))
    .slice(0, limit)
    .map((item) => item.entry);
};
