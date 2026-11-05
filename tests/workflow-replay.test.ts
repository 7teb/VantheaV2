import assert from "node:assert/strict";
import { test } from "node:test";
import { call_key, parse_journal, type CallEndStatus, type JournalRecord } from "../electron/workflows/records.ts";
import { create_replay } from "../electron/workflows/replay.ts";

const record = (index: number, key: string, status: CallEndStatus | null, rank = index, result: unknown = `r${index}`): JournalRecord => ({
  index,
  kind: "agent",
  key,
  end: status ? { status, rank, result } : null,
});

const journal = (...records: JournalRecord[]) => new Map(records.map((entry) => [entry.index, entry]));

test("a fresh run is live from the start", () => {
  const replay = create_replay(null);
  assert.equal(replay.is_live(), true);
  assert.equal(replay.match(0, "k"), null);
  assert.equal(create_replay(new Map()).is_live(), true);
});

test("the unchanged prefix hits and the first changed call goes live for good", () => {
  const replay = create_replay(journal(record(0, "a", "completed"), record(1, "b", "completed"), record(2, "c", "completed")));
  assert.deepEqual(replay.match(0, "a"), { status: "completed", rank: 0, result: "r0" });
  assert.equal(replay.match(1, "changed"), null);
  assert.equal(replay.is_live(), true);
  assert.equal(replay.match(2, "c"), null);
});

test("failed, interrupted, stopped and unfinished calls rerun, skipped calls replay null", () => {
  for (const status of ["failed", "interrupted", "stopped"] as const) {
    assert.equal(create_replay(journal(record(0, "a", status))).match(0, "a"), null, status);
  }
  assert.equal(create_replay(journal(record(0, "a", null))).match(0, "a"), null);
  assert.deepEqual(create_replay(journal(record(0, "a", "skipped", 0, null))).match(0, "a"), { status: "skipped", rank: 0, result: null });
  assert.equal(create_replay(journal(record(0, "a", "completed"))).match(1, "a"), null);
});

test("hits are delivered one at a time in their old completion order, each after its ack", () => {
  const replay = create_replay(journal(record(0, "a", "completed", 2), record(1, "b", "completed", 0), record(2, "c", "completed", 1)));
  const delivered: number[] = [];
  let seq = 0;
  const deliver = (index: number) => () => {
    delivered.push(index);
    seq += 1;
    return seq;
  };
  for (const [index, key] of [[0, "a"], [1, "b"]] as const) {
    const hit = replay.match(index, key);
    assert.ok(hit);
    replay.hold(hit.rank)(deliver(index));
  }
  assert.equal(delivered.length, 0, "nothing is delivered before the first batch is acknowledged");
  replay.acked(0);
  assert.deepEqual(delivered, [1]);
  const hit = replay.match(2, "c");
  assert.ok(hit);
  replay.hold(hit.rank)(deliver(2));
  assert.deepEqual(delivered, [1], "a call registered while waiting for an ack waits");
  replay.acked(99);
  assert.deepEqual(delivered, [1], "a foreign ack changes nothing");
  replay.acked(1);
  assert.deepEqual(delivered, [1, 2]);
  replay.acked(2);
  assert.deepEqual(delivered, [1, 2, 0]);
});

test("a hit whose result is not ready yet holds back the hits after it", () => {
  const replay = create_replay(journal(record(0, "a", "completed", 0), record(1, "b", "completed", 1)));
  const delivered: number[] = [];
  const first = replay.hold(replay.match(0, "a")?.rank ?? -1);
  const second = replay.hold(replay.match(1, "b")?.rank ?? -1);
  replay.acked(0);
  second(() => {
    delivered.push(1);
    return 2;
  });
  assert.equal(delivered.length, 0);
  first(() => {
    delivered.push(0);
    return 1;
  });
  assert.deepEqual(delivered, [0]);
  replay.acked(1);
  assert.deepEqual(delivered, [0, 1]);
});

test("going live flushes every waiting hit at once", () => {
  const replay = create_replay(journal(record(0, "a", "completed", 1), record(1, "b", "completed", 0), record(2, "c", "completed", 2)));
  const delivered: number[] = [];
  replay.hold(replay.match(0, "a")?.rank ?? -1)(() => {
    delivered.push(0);
    return 1;
  });
  replay.hold(replay.match(1, "b")?.rank ?? -1)(() => {
    delivered.push(1);
    return 2;
  });
  assert.equal(replay.match(2, "new"), null);
  assert.deepEqual(delivered.toSorted(), [0, 1]);
});

test("journal lines parse into call records and keys ignore object key order", () => {
  const records = parse_journal([
    { type: "call", index: 0, kind: "agent", key: "k0" },
    { type: "end", index: 0, status: "completed", rank: 3, result: { a: 1 } },
    { type: "call", index: 1, kind: "workflow", key: "k1" },
    { type: "end", index: 1, status: "bogus", rank: 4, result: null },
    { type: "end", index: 0, status: "failed", rank: 9, result: null },
    { type: "call", index: -1, kind: "agent", key: "bad" },
    { type: "call", index: 2, kind: "agent" },
    "not a record",
  ]);
  assert.deepEqual([...records.values()], [
    { index: 0, kind: "agent", key: "k0", end: { status: "completed", rank: 3, result: { a: 1 } } },
    { index: 1, kind: "workflow", key: "k1", end: { status: "interrupted", rank: 4, result: null } },
  ]);
  assert.equal(call_key(["agent", { b: 1, a: [{ y: 2, x: 1 }] }]), call_key(["agent", { a: [{ x: 1, y: 2 }], b: 1 }]));
  assert.notEqual(call_key(["agent", "p1"]), call_key(["agent", "p2"]));
  assert.equal(call_key(["agent", { a: 1, b: undefined }]), call_key(["agent", { a: 1 }]));
});
