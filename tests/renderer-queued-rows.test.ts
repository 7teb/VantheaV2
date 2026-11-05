import assert from "node:assert/strict";
import { test } from "node:test";
import { drop_leaving, shown_rows, track_leaving, type LeavingRow } from "../src/features/composer/leaving-rows.ts";

type Row = { id: string };

const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));

const ids = (shown: { item: Row; leaving: boolean }[]) => shown.map(({ item, leaving }) => (leaving ? `-${item.id}` : item.id));

test("a removed row stays in place as leaving until its exit ends", () => {
  const before = rows("a", "b", "c");
  const after = [before[0], before[2]];
  const leaving = track_leaving(before, after, []);
  assert.deepEqual(ids(shown_rows(after, leaving)), ["a", "-b", "c"]);
  assert.deepEqual(ids(shown_rows(after, drop_leaving(leaving, "b"))), ["a", "c"]);
});

test("the last row leaves while the queue is already empty", () => {
  const before = rows("a");
  const leaving = track_leaving(before, [], []);
  assert.deepEqual(ids(shown_rows([], leaving)), ["-a"]);
  assert.deepEqual(drop_leaving(leaving, "a"), []);
});

test("rows that leave one after another keep their order and an added row is not leaving", () => {
  const first = rows("a", "b", "c");
  let leaving: LeavingRow<Row>[] = track_leaving(first, first.slice(1), []);
  const second = first.slice(2);
  leaving = track_leaving(first.slice(1), second, leaving);
  assert.deepEqual(ids(shown_rows(second, leaving)), ["-a", "-b", "c"]);
  const third = [...second, { id: "d" }];
  leaving = track_leaving(second, third, leaving);
  assert.deepEqual(ids(shown_rows(third, leaving)), ["-a", "-b", "c", "d"]);
});

test("a lower row that finishes first leaves a later leaving row in its place", () => {
  const first = rows("a", "b", "c");
  let leaving: LeavingRow<Row>[] = track_leaving(first, first.slice(1), []);
  const second = first.slice(2);
  leaving = track_leaving(first.slice(1), second, leaving);
  leaving = drop_leaving(leaving, "a");
  assert.deepEqual(ids(shown_rows(second, leaving)), ["-b", "c"]);
  assert.deepEqual(ids(shown_rows(second, drop_leaving(leaving, "b"))), ["c"]);
});

test("a row that comes back under the same id is no longer leaving", () => {
  const before = rows("a", "b");
  let leaving = track_leaving(before, [before[1]], []);
  leaving = track_leaving([before[1]], before, leaving);
  assert.deepEqual(leaving, []);
  assert.deepEqual(ids(shown_rows(before, leaving)), ["a", "b"]);
});

test("rows removed from the end and then the middle return in their old order", () => {
  const first = rows("a", "b", "c");
  let leaving: LeavingRow<Row>[] = track_leaving(first, first.slice(0, 2), []);
  leaving = track_leaving(first.slice(0, 2), first.slice(0, 1), leaving);
  assert.deepEqual(ids(shown_rows(first.slice(0, 1), leaving)), ["a", "-b", "-c"]);
});
