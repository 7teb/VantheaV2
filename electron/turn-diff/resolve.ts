import type { Message } from "../../shared/chat.ts";
import type { DiffNote, DiffScope } from "../../shared/turn-diff.ts";
import { turn_ran_before } from "../../shared/turn-span.ts";
import { failure_of, tree_of, type TurnRecord } from "./records.ts";

type GitEnd = { kind: "snapshot" | "next_turn"; tree: string; at: string } | { kind: "live" };

type RecordedEnd = { kind: "snapshot"; at: string } | { kind: "live" };

export type Resolved =
  | { kind: "git"; prefix: string; base: string; base_at: string; end: GitEnd; notes: DiffNote[]; unreadable: string[] }
  | { kind: "recorded"; records: TurnRecord[]; base_at: string; end: RecordedEnd; notes: DiffNote[] }
  | { kind: "none" };

const none: Resolved = { kind: "none" };

const end_missing = (record: TurnRecord): DiffNote => {
  const failed = failure_of(record.end);
  return failed ? { kind: "end_missing", reason: "snapshot_failed", detail: failed.error } : { kind: "end_missing", reason: "app_closed", detail: "" };
};

const git_end_missing = (record: TurnRecord): DiffNote =>
  record.mode === "recorded" && record.no_git ? { kind: "end_missing", reason: "snapshot_failed", detail: record.no_git.detail } : end_missing(record);

const no_git_note = (record: TurnRecord): DiffNote[] => (record.no_git ? [{ kind: "no_git", reason: record.no_git.reason, detail: record.no_git.detail }] : []);

const earlier_note = (messages: Message[], record: TurnRecord): DiffNote[] =>
  turn_ran_before(messages, record.message_id) ? [{ kind: "earlier_turns_missing", before: record.began_at }] : [];

const resolve_git_turn = (records: TurnRecord[], from: TurnRecord, to_at: number, running_id: string | null): Resolved => {
  const start = tree_of(from.start);
  const to = records[to_at];
  if (!start || !to) return none;
  const base = { kind: "git" as const, prefix: from.repo?.prefix ?? "", base: start.tree, base_at: start.at };
  if (to.message_id === running_id) return { ...base, end: { kind: "live" }, notes: [{ kind: "running" }], unreadable: start.unreadable };
  const end = tree_of(to.end);
  if (end) return { ...base, end: { kind: "snapshot", tree: end.tree, at: end.at }, notes: [], unreadable: [...start.unreadable, ...end.unreadable] };
  const next = records.slice(to_at + 1).map((record) => tree_of(record.start)).find((point) => point !== null);
  if (next) return { ...base, end: { kind: "next_turn", tree: next.tree, at: next.at }, notes: [git_end_missing(to)], unreadable: [...start.unreadable, ...next.unreadable] };
  return { ...base, end: { kind: "live" }, notes: [git_end_missing(to)], unreadable: start.unreadable };
};

const resolve_recorded_turn = (records: TurnRecord[], from_at: number, to_at: number, running_id: string | null): Resolved => {
  const from = records[from_at];
  const to = records[to_at];
  if (!from?.start || !to) return none;
  const base = { kind: "recorded" as const, records: records.slice(from_at, to_at + 1).filter((record) => record.mode === "recorded"), base_at: from.start.at };
  if (to.message_id === running_id) return { ...base, end: { kind: "live" }, notes: [...no_git_note(from), { kind: "running" }] };
  if (to.end) return { ...base, end: { kind: "snapshot", at: to.end.at }, notes: no_git_note(from) };
  return { ...base, end: { kind: "live" }, notes: [...no_git_note(from), end_missing(to)] };
};

const resolve_turn = (records: TurnRecord[], from_id: string, to_id: string, running_id: string | null): Resolved => {
  const from_at = records.findIndex((record) => record.message_id === from_id);
  const to_at = records.findIndex((record) => record.message_id === to_id);
  const from = records[from_at];
  if (!from || to_at < from_at) return none;
  if (from.mode === "git") return resolve_git_turn(records, from, to_at, running_id);
  if (from.mode === "recorded") return resolve_recorded_turn(records, from_at, to_at, running_id);
  return none;
};

const resolve_chat = (records: TurnRecord[], messages: Message[]): Resolved => {
  const base_at = records.findIndex((record) => record.mode === "git" && tree_of(record.start) !== null);
  const base = records[base_at];
  const start = tree_of(base?.start ?? null);
  if (base && start) {
    const notes: DiffNote[] = base_at > 0 ? [{ kind: "earlier_turns_missing", before: base.began_at }] : earlier_note(messages, base);
    return { kind: "git", prefix: base.repo?.prefix ?? "", base: start.tree, base_at: start.at, end: { kind: "live" }, notes, unreadable: start.unreadable };
  }
  const recorded = records.filter((record) => record.mode === "recorded");
  const first = recorded[0];
  const newest = recorded.at(-1);
  if (!first?.start || !newest) return none;
  return { kind: "recorded", records: recorded, base_at: first.start.at, end: { kind: "live" }, notes: [...no_git_note(newest), ...earlier_note(messages, first)] };
};

export const resolve = (records: TurnRecord[], scope: DiffScope, running_id: string | null, messages: Message[]): Resolved =>
  scope.kind === "chat" ? resolve_chat(records, messages) : resolve_turn(records, scope.from_id, scope.to_id, running_id);
