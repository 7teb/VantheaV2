import fs from "node:fs/promises";
import path from "node:path";
import type { GitFileDiff } from "../../shared/git-view.ts";
import type { DiffEntry, DiffStatus } from "../../shared/turn-diff.ts";
import { line_diff } from "../project/diff.ts";
import { is_inside, to_posix } from "../project/scope.ts";
import { error_text, missing_path } from "../storage/coerce.ts";
import { write_file_atomic } from "../storage/json-file.ts";
import { decode_text, looks_binary } from "../storage/text-codec.ts";
import { sort_entries } from "./git-read.ts";
import { slot_file, type ChatPaths } from "./paths.ts";
import type { RecordedFile, Slot, TurnRecord } from "./records.ts";

type Bytes = Buffer | null | "unread";

type RecordedPair = { before: Bytes; after: Bytes };

type RecordedUnion = { entries: DiffEntry[]; pairs: Map<string, RecordedPair>; unreadable: string[] };

type Side = { message_id: string; slot: Slot } | "disk";

const read_bytes = async (file: string, what: string): Promise<Bytes> => {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (missing_path(error)) return null;
    console.error(`[turn-diff] reading ${what} ${file} failed: ${error_text(error)}`);
    return "unread";
  }
};

export const relative_in = async (root: string, file: string): Promise<string | null> => {
  let real_root: string;
  try {
    real_root = await fs.realpath(root);
  } catch (error) {
    console.error(`[turn-diff] resolving the turn folder ${root} for ${file} failed: ${error_text(error)}`);
    return null;
  }
  for (const base of [real_root, path.resolve(root)]) {
    if (is_inside(base, file) && path.relative(base, file) !== "") return to_posix(path.relative(base, file));
  }
  return null;
};

const store_slot = async (paths: ChatPaths, record: TurnRecord, slot: number, side: "before" | "after", bytes: Bytes): Promise<Slot> => {
  if (bytes === null || bytes === "unread") return bytes;
  const target = slot_file(paths, record.message_id, slot, side);
  try {
    await write_file_atomic(target, bytes);
    return slot;
  } catch (error) {
    console.error(`[turn-diff] saving the ${side} copy of ${record.root}/${record.files[slot]?.path ?? ""} for turn ${record.message_id} to ${target} failed: ${error_text(error)}`);
    return "unread";
  }
};

export const capture_before = async (paths: ChatPaths, record: TurnRecord, relative: string): Promise<RecordedFile> => {
  const slot = record.files.length;
  const placeholder: RecordedFile = { path: relative, before: "unread" };
  record.files.push(placeholder);
  const bytes = await read_bytes(path.join(record.root, relative), `the file before the first write of turn ${record.message_id}`);
  placeholder.before = await store_slot(paths, record, slot, "before", bytes);
  return placeholder;
};

export const capture_after = async (paths: ChatPaths, record: TurnRecord): Promise<void> => {
  for (const [slot, file] of record.files.entries()) {
    const bytes = await read_bytes(path.join(record.root, file.path), `the file at the end of turn ${record.message_id}`);
    file.after = await store_slot(paths, record, slot, "after", bytes);
  }
};

const load = async (paths: ChatPaths, root: () => Promise<string>, file: string, side: Side, which: "before" | "after"): Promise<Bytes> => {
  if (side === "disk") return read_bytes(path.join(await root(), file), "the current file");
  if (side.slot === null || side.slot === "unread") return side.slot;
  return read_bytes(slot_file(paths, side.message_id, side.slot, which), `the saved ${which} copy`);
};

type Texts = { before: string | null; after: string | null; binary: boolean };

const texts_of = (before: Buffer | null, after: Buffer | null): Texts => {
  const old_text = before === null ? null : decode_text(before).text;
  const new_text = after === null ? null : decode_text(after).text;
  return { before: old_text, after: new_text, binary: (old_text !== null && looks_binary(old_text)) || (new_text !== null && looks_binary(new_text)) };
};

const counted = (pair: RecordedPair): Pick<DiffEntry, "added" | "removed" | "binary"> => {
  if (pair.before === "unread" || pair.after === "unread") return { added: null, removed: null, binary: false };
  const texts = texts_of(pair.before, pair.after);
  if (texts.binary) return { added: null, removed: null, binary: true };
  const diff = line_diff(texts.before, texts.after, null);
  return { added: diff.added, removed: diff.removed, binary: false };
};

const same_bytes = (pair: RecordedPair): boolean => {
  if (pair.before === "unread" || pair.after === "unread") return false;
  if (pair.before === null || pair.after === null) return pair.before === pair.after;
  return pair.before.equals(pair.after);
};

const status_of = (pair: RecordedPair): DiffStatus => {
  if (pair.before === null) return "added";
  if (pair.after === null) return "deleted";
  return "modified";
};

export const recorded_union = async (paths: ChatPaths, records: TurnRecord[], root: () => Promise<string>, live: boolean): Promise<RecordedUnion> => {
  const first = new Map<string, Side>();
  const last = new Map<string, Side>();
  for (const record of records) {
    for (const file of record.files) {
      if (!first.has(file.path)) first.set(file.path, { message_id: record.message_id, slot: file.before });
      if (file.after !== undefined) last.set(file.path, { message_id: record.message_id, slot: file.after });
    }
  }
  const entries: DiffEntry[] = [];
  const pairs = new Map<string, RecordedPair>();
  const unreadable: string[] = [];
  for (const [file, before_side] of first) {
    const pair: RecordedPair = {
      before: await load(paths, root, file, before_side, "before"),
      after: await load(paths, root, file, live ? "disk" : (last.get(file) ?? "disk"), "after"),
    };
    if (same_bytes(pair)) continue;
    if (pair.before === "unread" || pair.after === "unread") unreadable.push(file);
    pairs.set(file, pair);
    entries.push({ path: file, orig_path: null, status: status_of(pair), ...counted(pair), commits: null });
  }
  return { entries: sort_entries(entries), pairs, unreadable: unreadable.sort() };
};

export const recorded_file_diff = (pair: RecordedPair): GitFileDiff => {
  if (pair.before === "unread" || pair.after === "unread") return { kind: "object_missing" };
  const texts = texts_of(pair.before, pair.after);
  if (texts.binary) return { kind: "binary" };
  const diff = line_diff(texts.before, texts.after, null);
  if (diff.added > 0 || diff.removed > 0) return { kind: "text", lines: diff.lines };
  return texts.before === texts.after ? { kind: "unchanged" } : { kind: "eol_only" };
};
