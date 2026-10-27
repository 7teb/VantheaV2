import { span_of } from "../../shared/turn-span.ts";
import type { RepoPaths } from "../git/repo.ts";
import { git_failure_line } from "../git/run.ts";
import { error_text } from "../storage/coerce.ts";
import { open_cache } from "./cache.ts";
import { take_git_snapshot } from "./git-snapshot.ts";
import { resolve_target, type GitTarget } from "./git-target.ts";
import type { ChatPaths } from "./paths.ts";
import * as queue from "./queue.ts";
import { prune_turns, read_turns, tree_of, write_turns, type NoGit, type RepoRef, type TurnRecord, type TurnsFile } from "./records.ts";
import { capture_after, capture_before, relative_in } from "./recorded.ts";
import { announce, current_deps, inactive, paths_of } from "./state.ts";

type LateWork = { work_id: string; started_at: string; ended_at: string };

type NewestTurn = { message_id: string; start: Promise<void>; mode: TurnRecord["mode"] };

const starts = new Map<string, Promise<void>>();

const newest = new Map<string, NewestTurn>();

const waiting = new Map<string, LateWork[]>();

const handled = new Map<string, Set<string>>();

const start_key = (chat_id: string, message_id: string): string => `${chat_id}\n${message_id}`;

const now = (): string => new Date().toISOString();

const repo_ref = (paths: RepoPaths): RepoRef => ({ top: paths.top, common_dir: paths.common_dir, prefix: paths.prefix });

const failure_text = (error: unknown): string => git_failure_line(error) || error_text(error);

const fall_back = (record: TurnRecord, no_git: NoGit): void => {
  record.mode = "recorded";
  record.no_git = no_git;
  record.start = { at: now() };
};

const start_job = async (chat_id: string, message_id: string, root: string, began_at: string, signal: AbortSignal): Promise<void> => {
  const paths = paths_of(chat_id);
  const messages = await current_deps().messages(chat_id);
  if (!messages) return;
  const file = await prune_turns(paths, chat_id, await read_turns(paths, chat_id), new Set(messages.map((message) => message.id)));
  const previous = file.turns.at(-1);
  if (previous) previous.closed = true;
  const record: TurnRecord = { message_id, began_at, root, mode: "pending", repo: null, no_git: null, start: null, end: null, closed: false, late: [], files: [] };
  file.turns.push(record);
  await write_turns(paths, file);
  try {
    const target = await resolve_target(root, signal);
    if (target.kind === "recorded") {
      fall_back(record, { reason: target.reason, detail: target.detail });
    } else {
      const taken = await take_git_snapshot(target, paths, root, file.index_repo, signal);
      record.mode = "git";
      record.repo = repo_ref(target.paths);
      record.start = taken.point;
      file.index_repo = taken.index_repo;
    }
  } catch (error) {
    if (signal.aborted) throw error;
    console.error(`[turn-diff] taking the start snapshot of turn ${message_id} in chat ${chat_id} (${root}) failed:`, error);
    fall_back(record, { reason: "snapshot_failed", detail: failure_text(error) });
  }
  await write_turns(paths, file);
  const known = newest.get(chat_id);
  if (known?.message_id === message_id) known.mode = record.mode;
  announce(chat_id);
};

export const begin = (chat_id: string, message_id: string, root: string): void => {
  if (inactive(chat_id)) return;
  const key = start_key(chat_id, message_id);
  const began_at = now();
  const start = queue.run(chat_id, "start snapshot", (signal) => start_job(chat_id, message_id, root, began_at, signal));
  starts.set(key, start);
  newest.set(chat_id, { message_id, start, mode: "pending" });
  const forget = () => {
    if (starts.get(key) === start) starts.delete(key);
  };
  start.then(forget, forget);
};

export const ready = (chat_id: string, message_id: string, signal: AbortSignal): Promise<void> => {
  const start = starts.get(start_key(chat_id, message_id));
  if (!start) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    const settled = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    start.then(settled, settled);
  });
};

const take_end = async (chat_id: string, paths: ChatPaths, file: TurnsFile, record: TurnRecord, signal: AbortSignal): Promise<GitTarget | null> => {
  const at = now();
  if (record.mode === "recorded") {
    await capture_after(paths, record);
    record.end = { at };
    return null;
  }
  try {
    const target = await resolve_target(record.root, signal);
    if (target.kind !== "git") {
      const detail = target.detail ? `, ${target.detail}` : "";
      record.end = { error: `${record.root} is no longer a Git repository (${target.reason}${detail})`, at };
      console.error(`[turn-diff] taking the end snapshot of turn ${record.message_id} in chat ${chat_id} (${record.root}) failed: ${record.end.error}`);
      return null;
    }
    const taken = await take_git_snapshot(target, paths, record.root, file.index_repo, signal);
    record.end = taken.point;
    file.index_repo = taken.index_repo;
    return target;
  } catch (error) {
    if (signal.aborted) throw error;
    console.error(`[turn-diff] taking the end snapshot of turn ${record.message_id} in chat ${chat_id} (${record.root}) failed:`, error);
    record.end = { error: failure_text(error), at };
    return null;
  }
};

const prewarm = async (chat_id: string, paths: ChatPaths, file: TurnsFile, record: TurnRecord, target: GitTarget, signal: AbortSignal): Promise<void> => {
  const span = span_of((await current_deps().messages(chat_id)) ?? [], record.message_id);
  const from = file.turns.find((entry) => entry.message_id === span?.from_id);
  const to = file.turns.find((entry) => entry.message_id === span?.to_id);
  const base = tree_of(from?.start ?? null);
  const end = tree_of(to?.end ?? null);
  if (!from || !base || !end || from.mode !== "git") return;
  try {
    const store = await open_cache(paths, chat_id);
    await store.get(target, { prefix: from.repo?.prefix ?? "", base: base.tree, end: end.tree }, signal, true);
    await store.save(file);
  } catch (error) {
    if (signal.aborted) throw error;
    console.error(`[turn-diff] computing the summary of turn ${span?.from_id} to ${span?.to_id} in chat ${chat_id} ahead of time failed:`, error);
  }
};

const finish = async (chat_id: string, paths: ChatPaths, file: TurnsFile, record: TurnRecord, signal: AbortSignal): Promise<void> => {
  const target = await take_end(chat_id, paths, file, record, signal);
  await write_turns(paths, file);
  if (target) await prewarm(chat_id, paths, file, record, target, signal);
  announce(chat_id);
};

const end_job = async (chat_id: string, message_id: string, signal: AbortSignal): Promise<void> => {
  const paths = paths_of(chat_id);
  const file = await read_turns(paths, chat_id);
  const record = file.turns.find((entry) => entry.message_id === message_id);
  if (!record || record.mode === "pending") return;
  await finish(chat_id, paths, file, record, signal);
};

export const end = (chat_id: string, message_id: string): void => {
  if (inactive(chat_id)) return;
  void queue.run(chat_id, "end snapshot", (signal) => end_job(chat_id, message_id, signal));
};

const late_after_end = (record: TurnRecord, work: LateWork): boolean =>
  record.end !== null &&
  !record.late.includes(work.work_id) &&
  Date.parse(work.started_at) >= Date.parse(record.began_at) &&
  Date.parse(work.ended_at) > Date.parse(record.end.at);

const retake_job = async (chat_id: string, signal: AbortSignal): Promise<void> => {
  const works = waiting.get(chat_id) ?? [];
  waiting.delete(chat_id);
  const paths = paths_of(chat_id);
  const file = await read_turns(paths, chat_id);
  const record = file.turns.at(-1);
  if (!record || record.closed || record.mode === "pending") return;
  const fresh = works.filter((work) => late_after_end(record, work));
  if (!fresh.length) return;
  record.late.push(...fresh.map((work) => work.work_id));
  await finish(chat_id, paths, file, record, signal);
};

export const work_ended = (chat_id: string, work_id: string, started_at: string, ended_at: string): void => {
  if (inactive(chat_id)) return;
  const seen = handled.get(chat_id) ?? new Set<string>();
  handled.set(chat_id, seen);
  if (seen.has(work_id)) return;
  seen.add(work_id);
  const work: LateWork = { work_id, started_at, ended_at };
  const queued = waiting.get(chat_id);
  if (queued) {
    queued.push(work);
    return;
  }
  waiting.set(chat_id, [work]);
  void queue.run(chat_id, "late work snapshot", (signal) => retake_job(chat_id, signal));
};

const before_write_job = async (chat_id: string, file: string): Promise<void> => {
  const paths = paths_of(chat_id);
  const turns = await read_turns(paths, chat_id);
  const record = turns.turns.at(-1);
  if (!record || record.mode !== "recorded") return;
  const relative = await relative_in(record.root, file);
  if (relative === null || record.files.some((entry) => entry.path === relative)) return;
  await capture_before(paths, record, relative);
  await write_turns(paths, turns);
};

export const before_write = async (chat_id: string, file: string): Promise<void> => {
  if (inactive(chat_id)) return;
  try {
    const known = newest.get(chat_id);
    if (known) await known.start;
    if (known?.mode === "git") return;
    await queue.run(chat_id, "copy before write", () => before_write_job(chat_id, file));
  } catch (error) {
    console.error(`[turn-diff] saving ${file} before the agent wrote it in chat ${chat_id} failed, its diff will be missing:`, error);
  }
};

export const forget_chat = (chat_id: string): void => {
  waiting.delete(chat_id);
  handled.delete(chat_id);
  newest.delete(chat_id);
  for (const key of starts.keys()) {
    if (key.startsWith(`${chat_id}\n`)) starts.delete(key);
  }
};
