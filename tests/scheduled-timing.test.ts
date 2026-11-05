import assert from "node:assert/strict";
import { test } from "node:test";
import { interval_ms, type ScheduledTask } from "../shared/scheduled.ts";
import { clock_back, due, next_slot } from "../electron/scheduled/timing.ts";

const hour = interval_ms["1h"];

const anchor = Date.parse("2026-11-04T10:00:00.000Z");

const task = (over: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: "t1",
  chat_id: "c1",
  prompt: "check",
  interval: "1h",
  enabled: true,
  choice: { model: "a/b", effort: "high", pro: false },
  mode: "auto",
  created_at: "2026-11-04T10:00:00.000Z",
  updated_at: "2026-11-04T10:00:00.000Z",
  next_run_at: "2026-11-04T11:00:00.000Z",
  last_run: null,
  runs: [],
  ...over,
});

test("next_slot steps one interval past an exact slot", () => {
  assert.equal(next_slot(anchor, "1h", anchor), anchor + hour);
  assert.equal(next_slot(anchor, "1h", anchor + hour), anchor + 2 * hour);
});

test("next_slot skips every missed slot and stays on the anchor grid", () => {
  const now = anchor + 5 * hour + 17 * 60_000;
  assert.equal(next_slot(anchor, "1h", now), anchor + 6 * hour);
  assert.equal(next_slot(anchor, "24h", anchor + 3 * interval_ms["24h"] + 1), anchor + 4 * interval_ms["24h"]);
  assert.equal(next_slot(anchor, "7d", anchor + 1), anchor + interval_ms["7d"]);
});

test("next_slot with an anchor in the future is one interval after the anchor", () => {
  assert.equal(next_slot(anchor + 10 * hour, "2h", anchor), anchor + 10 * hour + interval_ms["2h"]);
});

test("due needs an enabled task whose stored next run is not in the future", () => {
  const next = Date.parse("2026-11-04T11:00:00.000Z");
  assert.equal(due(task(), next - 1), false);
  assert.equal(due(task(), next), true);
  assert.equal(due(task(), next + 5 * hour), true);
  assert.equal(due(task({ enabled: false }), next + hour), false);
});

test("clock_back fires only when the stored next run is more than one interval ahead", () => {
  const next = Date.parse("2026-11-04T11:00:00.000Z");
  assert.equal(clock_back(task(), next - hour), false);
  assert.equal(clock_back(task(), next - hour - 1), true);
  assert.equal(clock_back(task({ interval: "24h" }), next - 2 * hour), false);
});
