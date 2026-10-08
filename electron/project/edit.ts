import fs from "node:fs/promises";
import { error_code } from "../storage/coerce.ts";
import { write_file_atomic } from "../storage/json-file.ts";
import { decode_text, encode_text, looks_binary, plain_utf8, type TextEncoding } from "../storage/text-codec.ts";
import { line_diff, type LineDiff } from "./diff.ts";
import { invalidate_index } from "./index.ts";
import { apply_replacement } from "./replace.ts";
import { resolve_write_target, type WriteTarget } from "./scope.ts";
import { record_original } from "./snapshots.ts";

export const max_write_bytes = 1024 * 1024;

export type PreparedEdit = { project_root: string; target: WriteTarget; previous: string | null; encoding: TextEncoding; next: string; diff: LineDiff };

export type PreparedReplace = PreparedEdit & { replaced: number; flexible: boolean };

type ExistingText = { text: string; encoding: TextEncoding };

const read_text = async (file: string): Promise<ExistingText | null> => {
  try {
    return decode_text(await fs.readFile(file));
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
  return { project_root, target, previous, encoding: existing?.encoding ?? plain_utf8, next: content, diff: line_diff(previous, content) };
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
    throw new Error(`${target.relative} does not exist; use write_file to create it`);
  }
  const replacement = apply_replacement(existing.text, old_string, new_string, expected);
  check_size(replacement.updated, "The edited file");
  return {
    project_root,
    target,
    previous: existing.text,
    encoding: existing.encoding,
    next: replacement.updated,
    diff: line_diff(existing.text, replacement.updated),
    replaced: replacement.replaced,
    flexible: replacement.flexible,
  };
};

export const commit_edit = async (prepared: PreparedEdit, turn_id: string) => {
  const current = await read_text(prepared.target.target);
  if ((current?.text ?? null) !== prepared.previous) {
    throw new Error(`${prepared.target.relative} changed on disk after this edit was prepared; read it again and redo the edit`);
  }
  await record_original(turn_id, prepared.project_root, prepared.target.relative, prepared.previous, prepared.encoding);
  await write_file_atomic(prepared.target.target, encode_text(prepared.next, prepared.encoding));
  invalidate_index(prepared.project_root);
};
