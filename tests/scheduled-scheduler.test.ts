import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { interval_ms, type ScheduledTask } from "../shared/scheduled.ts";
import { poke_scheduler, start_scheduler, stop_scheduler } from "../electron/scheduled/scheduler.ts";

const start_ms = Date.parse("2026-11-04T12:00:00.000Z");

const hour = interval_ms["1h"];

const iso = (ms: number) => new Date(ms).toISOString();

const task = (id: string, next_run_ms: number, over: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id,
  chat_id: `chat-${id}`,
  prompt: "check",
  interval: "1h",
  enabled: true,
  choice: { model: "a/b", effort: "high", pro: false },
  mode: "auto",
  created_at: iso(start_ms - 10 * hour),
  updated_at: iso(start_ms - 10 * hour),
  next_run_at: iso(next_run_ms),
  last_run: null,
  runs: [],
  ...over,
});

type Kit = { tasks: ScheduledTask[]; runs: string[]; busy: Set<string>; reads: number };

const scheduler_kit = (tasks: ScheduledTask[]): Kit => {
  const kit: Kit = { tasks, runs: [], busy: new Set(), reads: 0 };
  start_scheduler({
    tasks: () => {
      kit.reads += 1;
      return kit.tasks;
    },
    busy: (entry) => kit.busy.has(entry.id),
    advance: (id, next_run_at) => {
      kit.tasks = kit.tasks.map((entry) => (entry.id === id ? { ...entry, next_run_at } : entry));
    },
    run: (entry) => {
      kit.runs.push(entry.id);
    },
  });
  return kit;
};

const next_of = (kit: Kit, id: string) => Date.parse(kit.tasks.find((entry) => entry.id === id)?.next_run_at ?? "");

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: start_ms });
});

afterEach(() => {
  stop_scheduler();
  mock.timers.reset();
});

test("the timer wakes for the earliest enabled task and not before", () => {
  const kit = scheduler_kit([task("late", start_ms + 2 * hour), task("soon", start_ms + 10_000), task("off", start_ms + 5_000, { enabled: false })]);
  mock.timers.tick(9_999);
  assert.deepEqual(kit.runs, []);
  mock.timers.tick(1);
  assert.deepEqual(kit.runs, ["soon"]);
  assert.equal(next_of(kit, "soon"), start_ms + 10_000 + hour);
});

test("the scheduler wakes at least every 60 s and a wall-clock jump forward runs a due task at the next wake", () => {
  const kit = scheduler_kit([task("a", start_ms + 30 * 60_000)]);
  const reads_at_start = kit.reads;
  mock.timers.tick(59_999);
  assert.equal(kit.reads, reads_at_start);
  mock.timers.tick(1);
  assert.ok(kit.reads > reads_at_start);
  assert.deepEqual(kit.runs, []);
  mock.timers.setTime(start_ms + 40 * 60_000);
  mock.timers.tick(60_000);
  assert.deepEqual(kit.runs, ["a"]);
});

test("a task overdue by five intervals at start runs exactly once", () => {
  const kit = scheduler_kit([task("a", start_ms - 5 * hour - 10 * 60_000)]);
  assert.deepEqual(kit.runs, ["a"]);
  const next = next_of(kit, "a");
  assert.ok(next > start_ms && next <= start_ms + hour, iso(next));
  mock.timers.tick(30 * 60_000);
  assert.deepEqual(kit.runs, ["a"]);
});

test("a due tick while the chat is busy is skipped and the next run still moves on", () => {
  const kit = scheduler_kit([]);
  kit.busy.add("a");
  kit.tasks = [task("a", start_ms + 1_000)];
  poke_scheduler();
  mock.timers.tick(1_000);
  assert.deepEqual(kit.runs, []);
  assert.equal(next_of(kit, "a"), start_ms + 1_000 + hour);
  kit.busy.clear();
  mock.timers.tick(hour);
  assert.deepEqual(kit.runs, ["a"]);
});

test("a clock that went backwards resets the next run to one interval from now without a run", () => {
  const kit = scheduler_kit([task("a", start_ms + 5 * hour)]);
  assert.deepEqual(kit.runs, []);
  assert.equal(next_of(kit, "a"), start_ms + hour);
});

test("a disabled task never runs, however overdue it is", () => {
  const kit = scheduler_kit([task("a", start_ms - 3 * hour, { enabled: false })]);
  mock.timers.tick(5 * hour);
  assert.deepEqual(kit.runs, []);
});

test("a poke after creating a task with next run now starts it right away", () => {
  const kit = scheduler_kit([]);
  kit.tasks = [task("new", start_ms)];
  poke_scheduler();
  mock.timers.tick(0);
  assert.deepEqual(kit.runs, ["new"]);
});

test("a task that fell due during sleep runs once on resume", () => {
  const kit = scheduler_kit([task("a", start_ms + 10 * 60_000)]);
  mock.timers.setTime(start_ms + 3 * hour);
  poke_scheduler();
  mock.timers.tick(0);
  assert.deepEqual(kit.runs, ["a"]);
  assert.ok(next_of(kit, "a") > start_ms + 3 * hour);
  mock.timers.tick(0);
  assert.deepEqual(kit.runs, ["a"]);
});

test("stopping the scheduler cancels the pending wake", () => {
  const kit = scheduler_kit([task("a", start_ms + 1_000)]);
  stop_scheduler();
  mock.timers.tick(hour);
  assert.deepEqual(kit.runs, []);
});
