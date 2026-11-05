import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Message } from "../shared/chat.ts";
import type { TurnRecord } from "../electron/turn-diff/records.ts";
import { resolve } from "../electron/turn-diff/resolve.ts";
import { assistant_message, user_message } from "./fixtures/legacy/harness.ts";

const tree = (seed: string) => seed.repeat(40).slice(0, 40);

const at = (minute: number) => `2026-10-26T10:${String(minute).padStart(2, "0")}:00.000Z`;

const git_record = (id: string, minute: number, patch: Partial<TurnRecord> = {}): TurnRecord => ({
  message_id: id,
  began_at: at(minute),
  root: "D:\\proj\\web",
  mode: "git",
  repo: { top: "D:\\proj", common_dir: "D:\\proj\\.git", prefix: "web/" },
  no_git: null,
  start: { tree: tree(id.slice(-1)), at: at(minute), unreadable: [] },
  end: { tree: tree(String.fromCharCode(id.charCodeAt(id.length - 1) + 5)), at: at(minute + 1), unreadable: [] },
  closed: false,
  late: [],
  files: [],
  ...patch,
});

const recorded_record = (id: string, minute: number, patch: Partial<TurnRecord> = {}): TurnRecord => ({
  message_id: id,
  began_at: at(minute),
  root: "D:\\plain",
  mode: "recorded",
  repo: null,
  no_git: { reason: "not_repo", detail: "D:\\plain" },
  start: { at: at(minute) },
  end: { at: at(minute + 1) },
  closed: false,
  late: [],
  files: [],
  ...patch,
});

const turn = (from_id: string, to_id = from_id) => ({ kind: "turn" as const, from_id, to_id });

test("unknown ids, a reversed span and a pending start resolve to none", () => {
  const records = [git_record("a1", 0), git_record("a2", 10), git_record("p3", 20, { mode: "pending", start: null, end: null })];
  assert.deepEqual(resolve(records, turn("missing", "a1"), null, []), { kind: "none" });
  assert.deepEqual(resolve(records, turn("a1", "missing"), null, []), { kind: "none" });
  assert.deepEqual(resolve(records, turn("a2", "a1"), null, []), { kind: "none" });
  assert.deepEqual(resolve(records, turn("p3"), null, []), { kind: "none" });
  assert.deepEqual(resolve([], { kind: "chat" }, null, []), { kind: "none" });
});

test("a finished git turn runs from its first start snapshot to the end snapshot of its last member and joins their unreadable lists", () => {
  const records = [git_record("a1", 0, { start: { tree: tree("1"), at: at(0), unreadable: ["x.txt"] } }), git_record("a2", 10, { end: { tree: tree("9"), at: at(12), unreadable: ["y.txt"] } })];
  assert.deepEqual(resolve(records, turn("a1", "a2"), null, []), {
    kind: "git",
    prefix: "web/",
    base: tree("1"),
    base_at: at(0),
    end: { kind: "snapshot", tree: tree("9"), at: at(12) },
    notes: [],
    unreadable: ["x.txt", "y.txt"],
  });
});

test("a running last member ends at the folder now with a running note", () => {
  const records = [git_record("a1", 0, { end: null })];
  const resolved = resolve(records, turn("a1"), "a1", []);
  assert.equal(resolved.kind, "git");
  assert.deepEqual(resolved.kind === "git" ? [resolved.end, resolved.notes] : [], [{ kind: "live" }, [{ kind: "running" }]]);
});

test("a turn without an end snapshot ends at the next start snapshot, else at the folder now, and says why", () => {
  const closed = [git_record("a1", 0, { end: null }), git_record("a2", 10, { start: { tree: tree("7"), at: at(10), unreadable: ["late.txt"] } })];
  const next = resolve(closed, turn("a1"), null, []);
  assert.deepEqual(next.kind === "git" ? [next.end, next.notes, next.unreadable] : [], [
    { kind: "next_turn", tree: tree("7"), at: at(10) },
    [{ kind: "end_missing", reason: "app_closed", detail: "" }],
    ["late.txt"],
  ]);
  const failed = [git_record("a1", 0, { end: { error: "fatal: disk full", at: at(1) } })];
  const live = resolve(failed, turn("a1"), null, []);
  assert.deepEqual(live.kind === "git" ? [live.end, live.notes] : [], [{ kind: "live" }, [{ kind: "end_missing", reason: "snapshot_failed", detail: "fatal: disk full" }]]);
  const failed_with_next = [...failed, recorded_record("b2", 10), git_record("a3", 20)];
  const later = resolve(failed_with_next, turn("a1"), null, []);
  assert.deepEqual(later.kind === "git" ? [later.end, later.notes] : [], [
    { kind: "next_turn", tree: tree("3"), at: at(20) },
    [{ kind: "end_missing", reason: "snapshot_failed", detail: "fatal: disk full" }],
  ]);
});

test("a recorded turn is the union of its recorded members with the no_git note of its first member", () => {
  const records = [recorded_record("r1", 0), recorded_record("r2", 10), recorded_record("r3", 20, { end: null })];
  const done = resolve(records, turn("r1", "r2"), null, []);
  assert.deepEqual(done.kind === "recorded" ? [done.records.map((record) => record.message_id), done.end, done.notes, done.base_at] : [], [
    ["r1", "r2"],
    { kind: "snapshot", at: at(11) },
    [{ kind: "no_git", reason: "not_repo", detail: "D:\\plain" }],
    at(0),
  ]);
  const running = resolve(records, turn("r3"), "r3", []);
  assert.deepEqual(running.kind === "recorded" ? [running.end, running.notes] : [], [{ kind: "live" }, [{ kind: "no_git", reason: "not_repo", detail: "D:\\plain" }, { kind: "running" }]]);
  const closed = resolve(records, turn("r3"), null, []);
  assert.deepEqual(closed.kind === "recorded" ? [closed.end, closed.notes.at(-1)] : [], [{ kind: "live" }, { kind: "end_missing", reason: "app_closed", detail: "" }]);
});

test("the whole chat starts at the first git start snapshot and names the turns before it", () => {
  const records = [recorded_record("r1", 0), git_record("a2", 10), git_record("a3", 20)];
  assert.deepEqual(resolve(records, { kind: "chat" }, "a3", []), {
    kind: "git",
    prefix: "web/",
    base: tree("2"),
    base_at: at(10),
    end: { kind: "live" },
    notes: [{ kind: "earlier_turns_missing", before: at(10) }],
    unreadable: [],
  });
  const first_git = resolve(records.slice(1), { kind: "chat" }, null, []);
  assert.deepEqual(first_git.kind === "git" ? first_git.notes : null, []);
});

test("a chat with only recorded turns is the union of all of them up to the folder now", () => {
  const records = [recorded_record("r1", 0), recorded_record("r2", 10, { no_git: { reason: "git_missing", detail: "" } })];
  const resolved = resolve(records, { kind: "chat" }, null, []);
  assert.deepEqual(resolved.kind === "recorded" ? [resolved.records.length, resolved.end, resolved.notes, resolved.base_at] : [], [
    2,
    { kind: "live" },
    [{ kind: "no_git", reason: "git_missing", detail: "" }],
    at(0),
  ]);
});

const pre_feature = assistant_message("old", "answered before snapshots existed");

const compacted: AssistantMessage = { ...assistant_message("cmp", ""), steps: [{ id: "c:1", round: 0, kind: "compaction", status: "done", source: "manual" }] };

const chat_of = (...ids: string[]): Message[] => ids.flatMap((id) => [user_message(`u_${id}`, "go"), assistant_message(id, "done")]);

test("the whole chat names turns from before the first record, also when no record exists for them", () => {
  const git_records = [git_record("a2", 10), git_record("a3", 20)];
  const named = resolve(git_records, { kind: "chat" }, null, [user_message("u_old", "go"), pre_feature, ...chat_of("a2", "a3")]);
  assert.deepEqual(named.kind === "git" ? named.notes : null, [{ kind: "earlier_turns_missing", before: at(10) }]);
  const only_compaction = [user_message("u_cmp", "/compact"), compacted, ...chat_of("a2", "a3")];
  const quiet = resolve(git_records, { kind: "chat" }, null, only_compaction);
  assert.deepEqual(quiet.kind === "git" ? quiet.notes : null, []);
  const recorded_records = [recorded_record("r2", 10), recorded_record("r3", 20)];
  const recorded = resolve(recorded_records, { kind: "chat" }, null, [user_message("u_old", "go"), pre_feature, ...chat_of("r2", "r3")]);
  assert.deepEqual(recorded.kind === "recorded" ? recorded.notes : null, [
    { kind: "no_git", reason: "not_repo", detail: "D:\\plain" },
    { kind: "earlier_turns_missing", before: at(10) },
  ]);
  const unknown = resolve(git_records, { kind: "chat" }, null, [user_message("u_old", "go"), pre_feature]);
  assert.deepEqual(unknown.kind === "git" ? unknown.notes : null, []);
});

test("a joined member that fell back to recorded mode inside a git turn names its failed snapshot, not a closed app", () => {
  const failed_start = { reason: "snapshot_failed" as const, detail: "fatal: unable to write new index file" };
  const records = [git_record("a1", 0), recorded_record("b2", 10, { no_git: failed_start, end: { at: at(11) } }), git_record("a3", 20)];
  const next = resolve(records, turn("a1", "b2"), null, []);
  assert.deepEqual(next.kind === "git" ? [next.end, next.notes] : [], [
    { kind: "next_turn", tree: tree("3"), at: at(20) },
    [{ kind: "end_missing", reason: "snapshot_failed", detail: "fatal: unable to write new index file" }],
  ]);
  const live = resolve(records.slice(0, 2), turn("a1", "b2"), null, []);
  assert.deepEqual(live.kind === "git" ? [live.end, live.notes] : [], [{ kind: "live" }, [{ kind: "end_missing", reason: "snapshot_failed", detail: "fatal: unable to write new index file" }]]);
  const closed = resolve([git_record("a1", 0, { end: null })], turn("a1"), null, []);
  assert.deepEqual(closed.kind === "git" ? closed.notes : [], [{ kind: "end_missing", reason: "app_closed", detail: "" }]);
});
