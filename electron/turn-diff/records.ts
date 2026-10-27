import fs from "node:fs/promises";
import { no_git_reasons, type NoGitReason } from "../../shared/turn-diff.ts";
import { as_array, error_text, is_record } from "../storage/coerce.ts";
import { keep_corrupt, read_json, write_json } from "../storage/json-file.ts";
import { recorded_dir, type ChatPaths } from "./paths.ts";

export type TreePoint = { tree: string; at: string; unreadable: string[] };

type FailedPoint = { error: string; at: string };

type CapturedPoint = { at: string };

type Point = TreePoint | FailedPoint | CapturedPoint;

export type RepoRef = { top: string; common_dir: string; prefix: string };

export type NoGit = { reason: NoGitReason; detail: string };

export type Slot = number | null | "unread";

export type RecordedFile = { path: string; before: Slot; after?: Slot };

export type TurnRecord = {
  message_id: string;
  began_at: string;
  root: string;
  mode: "pending" | "git" | "recorded";
  repo: RepoRef | null;
  no_git: NoGit | null;
  start: Point | null;
  end: Point | null;
  closed: boolean;
  late: string[];
  files: RecordedFile[];
};

export type TurnsFile = { version: 1; index_repo: string | null; turns: TurnRecord[] };

const message_id_pattern = /^[A-Za-z0-9_-]{1,64}$/;

export const tree_pattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

const modes: readonly TurnRecord["mode"][] = ["pending", "git", "recorded"];

const empty_turns = (): TurnsFile => ({ version: 1, index_repo: null, turns: [] });

export const tree_of = (point: Point | null): TreePoint | null => (point !== null && "tree" in point ? point : null);

export const failure_of = (point: Point | null): FailedPoint | null => (point !== null && "error" in point ? point : null);

const iso = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

const strings = (value: unknown): string[] | null => (Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : null);

const parse_point = (value: unknown): Point | null | undefined => {
  if (value === null) return null;
  if (!is_record(value) || !iso(value.at)) return undefined;
  if (typeof value.tree === "string") {
    const unreadable = strings(value.unreadable);
    return tree_pattern.test(value.tree) && unreadable ? { tree: value.tree, at: value.at, unreadable } : undefined;
  }
  if (typeof value.error === "string") return { error: value.error, at: value.at };
  return { at: value.at };
};

const parse_slot = (value: unknown): Slot | undefined =>
  value === null || value === "unread" || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ? value : undefined;

const inside_path = (value: string): boolean => value.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !/[\\:]/.test(part));

const parse_file = (value: unknown): RecordedFile | null => {
  if (!is_record(value) || typeof value.path !== "string" || !inside_path(value.path)) return null;
  const before = parse_slot(value.before);
  if (before === undefined) return null;
  if (value.after === undefined) return { path: value.path, before };
  const after = parse_slot(value.after);
  return after === undefined ? null : { path: value.path, before, after };
};

const parse_repo = (value: unknown): RepoRef | null | undefined => {
  if (value === null) return null;
  if (!is_record(value) || typeof value.top !== "string" || typeof value.common_dir !== "string" || typeof value.prefix !== "string") return undefined;
  return { top: value.top, common_dir: value.common_dir, prefix: value.prefix };
};

const parse_no_git = (value: unknown): NoGit | null | undefined => {
  if (value === null) return null;
  if (!is_record(value) || typeof value.detail !== "string") return undefined;
  const reason = no_git_reasons.find((entry) => entry === value.reason);
  return reason ? { reason, detail: value.detail } : undefined;
};

const parse_files = (value: unknown): RecordedFile[] | null => {
  if (!Array.isArray(value)) return null;
  const files = value.map(parse_file);
  return files.every((file) => file !== null) ? files : null;
};

type Parsed = { record: TurnRecord } | { field: string };

const parse_record = (value: Record<string, unknown>, message_id: string): Parsed => {
  const mode = modes.find((entry) => entry === value.mode);
  const repo = parse_repo(value.repo);
  const no_git = parse_no_git(value.no_git);
  const start = parse_point(value.start);
  const end = parse_point(value.end);
  const late = strings(value.late);
  const files = parse_files(value.files);
  if (!iso(value.began_at)) return { field: "began_at" };
  if (typeof value.root !== "string") return { field: "root" };
  if (!mode) return { field: "mode" };
  if (repo === undefined) return { field: "repo" };
  if (no_git === undefined) return { field: "no_git" };
  if (start === undefined) return { field: "start" };
  if (end === undefined) return { field: "end" };
  if (typeof value.closed !== "boolean") return { field: "closed" };
  if (!late) return { field: "late" };
  if (!files) return { field: "files" };
  return { record: { message_id, began_at: value.began_at, root: value.root, mode, repo, no_git, start, end, closed: value.closed, late, files } };
};

const parse_turns = (value: unknown, chat_id: string): TurnsFile => {
  const raw = is_record(value) ? value : {};
  const turns: TurnRecord[] = [];
  for (const entry of as_array(raw.turns)) {
    const message_id = is_record(entry) && typeof entry.message_id === "string" ? entry.message_id : "";
    if (!is_record(entry) || !message_id_pattern.test(message_id)) {
      console.warn(`[turn-diff] dropped a turn record of chat ${chat_id} with the message id ${JSON.stringify(message_id)}: field message_id is invalid`);
      continue;
    }
    const parsed = parse_record(entry, message_id);
    if ("field" in parsed) {
      console.warn(`[turn-diff] dropped the turn record of message ${message_id} in chat ${chat_id}: field ${parsed.field} is invalid`);
      continue;
    }
    turns.push(parsed.record);
  }
  return { version: 1, index_repo: typeof raw.index_repo === "string" ? raw.index_repo : null, turns };
};

export const read_stored = async <T>(file: string, chat_id: string, what: string, parse: (value: unknown) => T, empty: () => T): Promise<T> => {
  const read = await read_json(file);
  if (read.status === "missing") return empty();
  if (read.status === "ok") return parse(read.value);
  try {
    const kept = await keep_corrupt(file);
    await fs.rm(file, { force: true });
    console.error(`[turn-diff] the ${what} of chat ${chat_id} could not be parsed (${read.error}), moved to ${kept} and read as empty`);
  } catch (error) {
    console.error(`[turn-diff] the ${what} of chat ${chat_id} could not be parsed (${read.error}) and keeping a copy failed: ${error_text(error)}`);
  }
  return empty();
};

export const read_turns = (paths: ChatPaths, chat_id: string): Promise<TurnsFile> =>
  read_stored(paths.turns, chat_id, "turn records", (value) => parse_turns(value, chat_id), empty_turns);

export const write_turns = (paths: ChatPaths, file: TurnsFile): Promise<void> => write_json(paths.turns, file);

export const prune_turns = async (paths: ChatPaths, chat_id: string, file: TurnsFile, kept_ids: Set<string>): Promise<TurnsFile> => {
  const dropped = file.turns.filter((record) => !kept_ids.has(record.message_id));
  for (const record of dropped) {
    if (record.mode !== "recorded") continue;
    try {
      await fs.rm(recorded_dir(paths, record.message_id), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      console.error(`[turn-diff] removing the recorded files of the pruned turn ${record.message_id} in chat ${chat_id} failed: ${error_text(error)}`);
    }
  }
  return dropped.length ? { ...file, turns: file.turns.filter((record) => kept_ids.has(record.message_id)) } : file;
};

export const trees_of = (file: TurnsFile): Set<string> =>
  new Set(file.turns.flatMap((record) => [tree_of(record.start)?.tree, tree_of(record.end)?.tree].filter((tree): tree is string => tree !== undefined)));
