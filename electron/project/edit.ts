import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { error_code } from "../storage/coerce.ts";
import { write_file_atomic } from "../storage/json-file.ts";
import { decode_text, encode_text, looks_binary, plain_utf8, type TextEncoding } from "../storage/text-codec.ts";
import { ToolFailureError } from "../tools/types.ts";
import { line_diff, type LineDiff } from "./diff.ts";
import { invalidate_index } from "./index.ts";
import { apply_replacement } from "./replace.ts";
import { resolve_write_target, type WriteTarget } from "./scope.ts";

export const max_write_bytes = 1024 * 1024;

export type PreparedEdit = {
  project_root: string;
  target: WriteTarget;
  previous: string | null;
  previous_sha256: string | null;
  next: string;
  bytes: Buffer;
  diff: LineDiff;
};

export type PreparedReplace = PreparedEdit & { replaced: number; flexible: boolean };

type ExistingText = { text: string; encoding: TextEncoding; sha256: string };

const sha256_of = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

const read_text = async (file: string): Promise<ExistingText | null> => {
  try {
    const bytes = await fs.readFile(file);
    return { ...decode_text(bytes), sha256: sha256_of(bytes) };
  } catch (error) {
    if (error_code(error) === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const read_existing = async (target: WriteTarget): Promise<ExistingText | null> => {
  const existing = target.exists ? await read_text(target.target) : null;
  if (existing && looks_binary(existing.text)) {
    throw new Error(`${target.relative} is a binary file and cannot be edited as text`);
  }
  return existing;
};

const check_size = (text: string, label: string) => {
  if (Buffer.byteLength(text, "utf8") > max_write_bytes) {
    throw new Error(`${label} exceeds the 1 MB write limit`);
  }
};

export const prepare_write = async (project_root: string, relative: string, content: string): Promise<PreparedEdit> => {
  check_size(content, "The file content");
  const target = await resolve_write_target(project_root, relative);
  const existing = await read_existing(target);
  const previous = existing?.text ?? null;
  const bytes = encode_text(content, existing?.encoding ?? plain_utf8);
  return { project_root, target, previous, previous_sha256: existing?.sha256 ?? null, next: content, bytes, diff: line_diff(previous, content) };
};

export const prepare_replace = async (
  project_root: string,
  relative: string,
  old_string: string,
  new_string: string,
  expected: number,
): Promise<PreparedReplace> => {
  const target = await resolve_write_target(project_root, relative);
  const existing = await read_existing(target);
  if (existing === null) {
    throw new ToolFailureError(`${target.relative} does not exist; use write_file to create it`, { kind: "not_in_project", path: target.relative });
  }
  const replacement = apply_replacement(existing.text, old_string, new_string, expected, target.relative);
  check_size(replacement.updated, "The edited file");
  return {
    project_root,
    target,
    previous: existing.text,
    previous_sha256: existing.sha256,
    next: replacement.updated,
    bytes: encode_text(replacement.updated, existing.encoding),
    diff: line_diff(existing.text, replacement.updated),
    replaced: replacement.replaced,
    flexible: replacement.flexible,
  };
};

const dir_queues = new Map<string, Promise<void>>();

export const with_dir_lock = async <T>(dir: string, work: () => Promise<T>): Promise<T> => {
  const key = await fs.realpath(dir);
  const turn = (dir_queues.get(key) ?? Promise.resolve()).then(work);
  const tail = turn.then(
    () => undefined,
    () => undefined,
  );
  dir_queues.set(key, tail);
  try {
    return await turn;
  } finally {
    if (dir_queues.get(key) === tail) {
      dir_queues.delete(key);
    }
  }
};

const stale_edit = (prepared: PreparedEdit, cause?: unknown) =>
  new Error(`${prepared.target.relative} changed on disk after this edit was prepared; read it again and redo the edit`, { cause });

const publish_edit = async (prepared: PreparedEdit): Promise<string> => {
  const current = await read_text(prepared.target.target);
  if ((current?.sha256 ?? null) !== prepared.previous_sha256) {
    throw stale_edit(prepared);
  }
  await write_file_atomic(prepared.target.target, prepared.bytes);
  invalidate_index(prepared.project_root);
  return sha256_of(prepared.bytes);
};

export const commit_edit = async (prepared: PreparedEdit): Promise<string> => {
  const dir = path.dirname(prepared.target.target);
  if (prepared.previous_sha256 === null) {
    await fs.mkdir(dir, { recursive: true });
  }
  try {
    return await with_dir_lock(dir, () => publish_edit(prepared));
  } catch (error) {
    if (error_code(error) === "ENOENT") {
      throw stale_edit(prepared, error);
    }
    throw error;
  }
};
