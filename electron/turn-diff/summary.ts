import type { Message } from "../../shared/chat.ts";
import type { GitFileDiff } from "../../shared/git-view.ts";
import { scope_key, type DiffEntry, type DiffNote, type DiffScope, type DiffSummary } from "../../shared/turn-diff.ts";
import { git_failure_line } from "../git/run.ts";
import { error_text } from "../storage/coerce.ts";
import { path_key } from "../storage/paths.ts";
import { open_cache, type PairStore } from "./cache.ts";
import { read_pair_file, type PairSummary, type TreePair } from "./git-read.ts";
import { take_git_snapshot } from "./git-snapshot.ts";
import { resolve_target, type GitTarget } from "./git-target.ts";
import type { ChatPaths } from "./paths.ts";
import * as queue from "./queue.ts";
import { read_turns, write_turns, type TreePoint, type TurnsFile } from "./records.ts";
import { recorded_file_diff, recorded_union } from "./recorded.ts";
import { resolve, type Resolved } from "./resolve.ts";
import { current_deps, inactive, paths_of } from "./state.ts";

type LiveTree = { root_key: string; point: TreePoint };

type GitResolved = Extract<Resolved, { kind: "git" }>;

type RecordedResolved = Extract<Resolved, { kind: "recorded" }>;

type GitRead = { target: GitTarget; pair: TreePair; summary: PairSummary; end_at: string; unreadable: string[] };

type Reader = {
  chat_id: string;
  paths: ChatPaths;
  file: TurnsFile;
  messages: Message[];
  store: PairStore;
  signal: AbortSignal;
  root: string | null;
  target: GitTarget | null;
  fresh_live: boolean;
};

const live = new Map<string, LiveTree>();

export const forget_live = (chat_id: string): void => {
  live.delete(chat_id);
};

const chat_root = async (reader: Reader): Promise<string> => {
  reader.root ??= await current_deps().chat_root(reader.chat_id);
  return reader.root;
};

const git_target = async (reader: Reader): Promise<GitTarget> => {
  if (reader.target) return reader.target;
  const root = await chat_root(reader);
  const target = await resolve_target(root, reader.signal);
  if (target.kind !== "git") {
    const detail = target.detail ? `, ${target.detail}` : "";
    throw new Error(`${root} cannot be read as a Git repository any more (${target.reason}${detail})`);
  }
  reader.target = target;
  return target;
};

const live_tree = async (reader: Reader, target: GitTarget): Promise<TreePoint> => {
  const root = await chat_root(reader);
  const root_key = path_key(root);
  const known = live.get(reader.chat_id);
  if (known && known.root_key === root_key && !reader.fresh_live) return known.point;
  const taken = await take_git_snapshot(target, reader.paths, root, reader.file.index_repo, reader.signal);
  if (taken.index_repo !== reader.file.index_repo) {
    reader.file.index_repo = taken.index_repo;
    await write_turns(reader.paths, reader.file);
  }
  live.set(reader.chat_id, { root_key, point: taken.point });
  reader.fresh_live = false;
  return taken.point;
};

type EndPoint = { tree: string; at: string; unreadable: string[]; cacheable: boolean };

const end_point = async (reader: Reader, target: GitTarget, resolved: GitResolved): Promise<EndPoint> => {
  if (resolved.end.kind !== "live") return { tree: resolved.end.tree, at: resolved.end.at, unreadable: [], cacheable: true };
  return { ...(await live_tree(reader, target)), cacheable: false };
};

const read_git = async (reader: Reader, resolved: GitResolved): Promise<GitRead> => {
  const target = await git_target(reader);
  const end = await end_point(reader, target, resolved);
  const pair: TreePair = { prefix: resolved.prefix, base: resolved.base, end: end.tree };
  const summary = await reader.store.get(target, pair, reader.signal, end.cacheable);
  return { target, pair, summary, end_at: end.at, unreadable: [...new Set([...resolved.unreadable, ...end.unreadable])].sort() };
};

const git_summary = async (reader: Reader, resolved: GitResolved): Promise<DiffSummary> => {
  const read = await read_git(reader, resolved);
  const notes: DiffNote[] = [...resolved.notes];
  if (read.unreadable.length) notes.push({ kind: "unreadable", paths: read.unreadable });
  if (read.summary.renames_skipped) notes.push({ kind: "renames_skipped" });
  return { kind: "ready", source: "git", base_at: resolved.base_at, end: { kind: resolved.end.kind, at: read.end_at }, entries: read.summary.entries, notes };
};

const read_recorded = (reader: Reader, resolved: RecordedResolved) => recorded_union(reader.paths, resolved.records, () => chat_root(reader), resolved.end.kind === "live");

const recorded_summary = async (reader: Reader, resolved: RecordedResolved): Promise<DiffSummary> => {
  const end_at = resolved.end.kind === "live" ? new Date().toISOString() : resolved.end.at;
  const union = await reader.store.recorded(resolved.records, resolved.end.kind !== "live", async () => {
    const read = await read_recorded(reader, resolved);
    return { entries: read.entries, unreadable: read.unreadable };
  });
  const notes: DiffNote[] = [...resolved.notes];
  if (union.unreadable.length) notes.push({ kind: "unreadable", paths: union.unreadable });
  return { kind: "ready", source: "recorded", base_at: resolved.base_at, end: { kind: resolved.end.kind, at: end_at }, entries: union.entries, notes };
};

const summarize = async (reader: Reader, scope: DiffScope, resolved: Resolved): Promise<DiffSummary> => {
  try {
    if (resolved.kind === "git") return await git_summary(reader, resolved);
    if (resolved.kind === "recorded") return await recorded_summary(reader, resolved);
    return { kind: "none" };
  } catch (error) {
    if (reader.signal.aborted) throw error;
    console.error(`[turn-diff] reading the diff ${scope_key(scope)} of chat ${reader.chat_id} failed:`, error);
    return { kind: "failed", error: git_failure_line(error) || error_text(error) };
  }
};

const open_reader = async (chat_id: string, signal: AbortSignal, fresh_live: boolean): Promise<Reader> => {
  const paths = paths_of(chat_id);
  const file = await read_turns(paths, chat_id);
  const messages = (await current_deps().messages(chat_id)) ?? [];
  return { chat_id, paths, file, messages, store: await open_cache(paths, chat_id), signal, root: null, target: null, fresh_live };
};

const resolve_in = (reader: Reader, scope: DiffScope): Resolved => resolve(reader.file.turns, scope, current_deps().running_turn(reader.chat_id), reader.messages);

export const summaries = (chat_id: string, scopes: DiffScope[]): Promise<DiffSummary[]> => {
  if (inactive(chat_id)) return Promise.resolve(scopes.map((): DiffSummary => ({ kind: "none" })));
  return queue.run(chat_id, "summaries", async (signal) => {
    const reader = await open_reader(chat_id, signal, true);
    const results: DiffSummary[] = [];
    for (const scope of scopes) results.push(await summarize(reader, scope, resolve_in(reader, scope)));
    await reader.store.save(reader.file);
    return results;
  });
};

const find_entry = (entries: DiffEntry[], path: string): DiffEntry => {
  const entry = entries.find((candidate) => candidate.path === path) ?? entries.find((candidate) => candidate.orig_path === path);
  if (!entry) throw new Error(`${path} is not a changed file of this diff`);
  return entry;
};

const file_diff = async (reader: Reader, resolved: Resolved, path: string): Promise<GitFileDiff> => {
  if (resolved.kind === "none") throw new Error("no snapshot exists for this diff");
  if (resolved.kind === "recorded") {
    const union = await read_recorded(reader, resolved);
    const entry = find_entry(union.entries, path);
    const pair = union.pairs.get(entry.path);
    if (!pair) throw new Error(`${path} has no saved contents in this diff`);
    return recorded_file_diff(pair);
  }
  const read = await read_git(reader, resolved);
  return read_pair_file(read.target, reader.paths, read.pair, find_entry(read.summary.entries, path), reader.signal);
};

export const file = (chat_id: string, scope: DiffScope, path: string): Promise<GitFileDiff> => {
  if (inactive(chat_id)) return Promise.reject(new Error(`chat ${chat_id} has no turn diffs`));
  return queue.run(chat_id, "file diff", async (signal) => {
    const reader = await open_reader(chat_id, signal, false);
    const diff = await file_diff(reader, resolve_in(reader, scope), path);
    await reader.store.save(reader.file);
    return diff;
  });
};
