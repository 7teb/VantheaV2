import { diff_statuses, type DiffEntry } from "../../shared/turn-diff.ts";
import { is_record } from "../storage/coerce.ts";
import { write_json } from "../storage/json-file.ts";
import { read_pair, type PairSummary, type TreePair } from "./git-read.ts";
import type { GitTarget } from "./git-target.ts";
import type { ChatPaths } from "./paths.ts";
import { read_stored, trees_of, type TurnRecord, type TurnsFile } from "./records.ts";

export type RecordedSummary = { entries: DiffEntry[]; unreadable: string[] };

export type PairCache = { version: 1; pairs: Record<string, PairSummary>; recorded: Record<string, RecordedSummary> };

export type PairStore = {
  get: (target: GitTarget, pair: TreePair, signal: AbortSignal, cacheable: boolean) => Promise<PairSummary>;
  recorded: (records: TurnRecord[], cacheable: boolean, read: () => Promise<RecordedSummary>) => Promise<RecordedSummary>;
  save: (file: TurnsFile) => Promise<void>;
};

const count = (value: unknown): number | null | undefined => (value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ? value : undefined);

const commit = (value: unknown): string | null | undefined => (value === null || typeof value === "string" ? value : undefined);

const parse_commits = (value: unknown): DiffEntry["commits"] | undefined => {
  if (value === null) return null;
  if (!is_record(value)) return undefined;
  const from = commit(value.from);
  const to = commit(value.to);
  return from === undefined || to === undefined ? undefined : { from, to };
};

const parse_entry = (value: unknown): DiffEntry | null => {
  if (!is_record(value) || typeof value.path !== "string" || typeof value.binary !== "boolean") return null;
  const orig_path = value.orig_path === null || typeof value.orig_path === "string" ? value.orig_path : undefined;
  const status = diff_statuses.find((entry) => entry === value.status);
  const added = count(value.added);
  const removed = count(value.removed);
  const commits = parse_commits(value.commits);
  if (orig_path === undefined || !status || added === undefined || removed === undefined || commits === undefined) return null;
  return { path: value.path, orig_path, status, added, removed, binary: value.binary, commits };
};

const parse_entries = (value: unknown): DiffEntry[] | null => {
  if (!Array.isArray(value)) return null;
  const entries = value.map(parse_entry);
  return entries.every((entry) => entry !== null) ? entries : null;
};

const parse_pair = (value: unknown): PairSummary | null => {
  if (!is_record(value) || typeof value.renames_skipped !== "boolean") return null;
  const entries = parse_entries(value.entries);
  return entries ? { entries, renames_skipped: value.renames_skipped } : null;
};

const parse_recorded = (value: unknown): RecordedSummary | null => {
  if (!is_record(value) || !Array.isArray(value.unreadable) || !value.unreadable.every((file) => typeof file === "string")) return null;
  const entries = parse_entries(value.entries);
  return entries ? { entries, unreadable: value.unreadable } : null;
};

const parse_map = <T>(value: unknown, parse: (entry: unknown) => T | null, chat_id: string, what: string): Record<string, T> => {
  const parsed: Record<string, T> = {};
  for (const [key, entry] of Object.entries(is_record(value) ? value : {})) {
    const item = parse(entry);
    if (item) parsed[key] = item;
    else console.warn(`[turn-diff] dropped the cached ${what} ${key} of chat ${chat_id}: it does not have the stored shape`);
  }
  return parsed;
};

const parse_cache = (value: unknown, chat_id: string): PairCache => {
  const raw = is_record(value) ? value : {};
  return { version: 1, pairs: parse_map(raw.pairs, parse_pair, chat_id, "summary"), recorded: parse_map(raw.recorded, parse_recorded, chat_id, "recorded summary") };
};

const pair_key = (pair: TreePair): string => `${pair.prefix}:${pair.base}:${pair.end}`;

const pair_trees = (key: string): string[] => key.split(":").slice(-2);

const recorded_token = (record: TurnRecord): string | null =>
  record.mode === "recorded" && record.end !== null && record.files.every((file) => file.after !== undefined) ? `${record.message_id}@${record.end.at}` : null;

const recorded_key = (records: TurnRecord[]): string | null => {
  const tokens = records.map(recorded_token);
  return tokens.length > 0 && tokens.every((token) => token !== null) ? tokens.join("|") : null;
};

export const kept_cache = (cache: PairCache, file: TurnsFile): PairCache => {
  const trees = trees_of(file);
  const tokens = new Set(file.turns.map(recorded_token));
  return {
    version: 1,
    pairs: Object.fromEntries(Object.entries(cache.pairs).filter(([key]) => pair_trees(key).every((tree) => trees.has(tree)))),
    recorded: Object.fromEntries(Object.entries(cache.recorded).filter(([key]) => key.split("|").every((token) => tokens.has(token)))),
  };
};

export const read_cache = (paths: ChatPaths, chat_id: string): Promise<PairCache> =>
  read_stored(paths.summaries, chat_id, "cached summaries", (value) => parse_cache(value, chat_id), () => ({ version: 1, pairs: {}, recorded: {} }));

export const write_cache = (paths: ChatPaths, cache: PairCache): Promise<void> => write_json(paths.summaries, cache);

export const open_cache = async (paths: ChatPaths, chat_id: string): Promise<PairStore> => {
  const cache = await read_cache(paths, chat_id);
  let changed = false;
  return {
    get: async (target, pair, signal, cacheable) => {
      const key = pair_key(pair);
      const known = cache.pairs[key];
      if (known) return known;
      const read = await read_pair(target, paths, pair, signal);
      if (cacheable) {
        cache.pairs[key] = read;
        changed = true;
      }
      return read;
    },
    recorded: async (records, cacheable, read) => {
      const key = cacheable ? recorded_key(records) : null;
      const known = key === null ? undefined : cache.recorded[key];
      if (known) return known;
      const summary = await read();
      if (key !== null) {
        cache.recorded[key] = summary;
        changed = true;
      }
      return summary;
    },
    save: async (file) => {
      if (!changed) return;
      await write_cache(paths, kept_cache(cache, file));
      changed = false;
    },
  };
};
