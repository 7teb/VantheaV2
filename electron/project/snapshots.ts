import fs from "node:fs/promises";
import path from "node:path";
import type { UndoResult } from "../../shared/ipc/chats.ts";
import { as_array, as_record, as_string, error_text, pick } from "../storage/coerce.ts";
import { read_json, write_file_atomic, write_json } from "../storage/json-file.ts";
import { charsets, encode_text, plain_utf8, type TextEncoding } from "../storage/text-codec.ts";
import { invalidate_index } from "./index.ts";
import { resolve_write_target } from "./scope.ts";

type SnapshotFile = { relative: string; original: string | null; encoding: TextEncoding };

type Snapshot = { version: 1; turn_id: string; project_root: string; created_at: string; files: SnapshotFile[] };

const max_snapshots = 80;

const max_age_ms = 14 * 24 * 60 * 60 * 1000;

const turn_id_pattern = /^[\w-]{1,128}$/;

const chains = new Map<string, Promise<void>>();

let dir: string | null = null;

const snapshot_dir = (): string => {
  if (!dir) {
    throw new Error("snapshots used before init_snapshots");
  }
  return dir;
};

const snapshot_file = (turn_id: string): string => {
  if (!turn_id_pattern.test(turn_id)) {
    throw new Error(`invalid turn id for a snapshot: ${turn_id.slice(0, 80)}`);
  }
  return path.join(snapshot_dir(), `${turn_id}.json`);
};

const parse_snapshot = (turn_id: string, value: unknown): Snapshot => {
  const raw = as_record(value);
  const files = as_array(raw.files).map((entry) => {
    const file = as_record(entry);
    const encoding = as_record(file.encoding);
    return {
      relative: as_string(file.relative),
      original: typeof file.original === "string" ? file.original : null,
      encoding: { charset: pick(encoding.charset, charsets, plain_utf8.charset), bom: encoding.bom === true },
    };
  });
  return {
    version: 1,
    turn_id,
    project_root: as_string(raw.project_root),
    created_at: as_string(raw.created_at),
    files: files.filter((file) => file.relative),
  };
};

const load_snapshot = async (turn_id: string): Promise<Snapshot | null> => {
  const file = snapshot_file(turn_id);
  const stored = await read_json(file);
  if (stored.status === "missing") {
    return null;
  }
  if (stored.status === "corrupt") {
    throw new Error(`snapshot ${file} is not valid JSON: ${stored.error}`);
  }
  return parse_snapshot(turn_id, stored.value);
};

export const prune_snapshots = async () => {
  const root = snapshot_dir();
  const now = Date.now();
  const entries: { name: string; mtime: number }[] = [];
  for (const name of await fs.readdir(root)) {
    if (name.endsWith(".json")) {
      entries.push({ name, mtime: (await fs.stat(path.join(root, name))).mtimeMs });
    }
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  for (const [index, entry] of entries.entries()) {
    if (index >= max_snapshots || now - entry.mtime > max_age_ms) {
      await fs.rm(path.join(root, entry.name), { force: true });
    }
  }
};

export const init_snapshots = async (snapshot_root: string) => {
  dir = snapshot_root;
  chains.clear();
  await fs.mkdir(snapshot_root, { recursive: true });
  try {
    await prune_snapshots();
  } catch (error) {
    console.warn(`[snapshots] pruning ${snapshot_root} at startup failed: ${error_text(error)}`);
  }
};

const append_original = async (turn_id: string, project_root: string, relative: string, original: string | null, encoding: TextEncoding) => {
  const existing = await load_snapshot(turn_id);
  const snapshot = existing ?? { version: 1, turn_id, project_root, created_at: new Date().toISOString(), files: [] };
  const key = relative.toLowerCase();
  if (snapshot.files.some((file) => file.relative.toLowerCase() === key)) {
    return;
  }
  snapshot.files.push({ relative, original, encoding });
  await write_json(snapshot_file(turn_id), snapshot);
  if (!existing) {
    prune_snapshots().catch((error: unknown) => console.warn(`[snapshots] pruning ${snapshot_dir()} failed: ${error_text(error)}`));
  }
};

const enqueue = <T>(turn_id: string, work: () => Promise<T>): Promise<T> => {
  const next = (chains.get(turn_id) ?? Promise.resolve()).then(work);
  const settled = next.then(
    () => undefined,
    (error: unknown) => console.warn(`[snapshots] snapshot work for turn ${turn_id} failed: ${error_text(error)}`),
  );
  chains.set(turn_id, settled);
  void settled.then(() => {
    if (chains.get(turn_id) === settled) {
      chains.delete(turn_id);
    }
  });
  return next;
};

export const record_original = (turn_id: string, project_root: string, relative: string, original: string | null, encoding: TextEncoding): Promise<void> =>
  enqueue(turn_id, () => append_original(turn_id, project_root, relative, original, encoding));

const restore = async (project_root: string, file: SnapshotFile) => {
  const target = await resolve_write_target(project_root, file.relative);
  if (file.original === null) {
    await fs.rm(target.target, { force: true });
    return;
  }
  await write_file_atomic(target.target, encode_text(file.original, file.encoding));
};

const undo_now = async (turn_id: string): Promise<UndoResult> => {
  const snapshot = await load_snapshot(turn_id);
  if (!snapshot || !snapshot.files.length) {
    throw new Error("No recorded file edits to undo for this turn; snapshots are kept for 14 days and only cover write_file and replace_in_file.");
  }
  const restored: string[] = [];
  const failed: SnapshotFile[] = [];
  for (const file of snapshot.files) {
    try {
      await restore(snapshot.project_root, file);
      restored.push(file.relative);
    } catch (error) {
      console.warn(`[snapshots] restoring ${file.relative} in ${snapshot.project_root} for turn ${turn_id} failed: ${error_text(error)}`);
      failed.push(file);
    }
  }
  invalidate_index(snapshot.project_root);
  if (failed.length) {
    await write_json(snapshot_file(turn_id), { ...snapshot, files: failed });
  } else {
    await fs.rm(snapshot_file(turn_id), { force: true });
  }
  return { restored, failed: failed.map((file) => file.relative) };
};

export const undo_turn = (turn_id: string): Promise<UndoResult> => enqueue(turn_id, () => undo_now(turn_id));
