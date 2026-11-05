import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunMark, ScheduledTaskView, TaskRun } from "../shared/scheduled.ts";
import { clock_label, dial_ratio, dial_text, soonest_id } from "../src/features/scheduled/scheduled-time.ts";
import { card_state, dial_state, page_order, status_kind, trail_marks } from "../src/features/scheduled/task-state.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const t: Translate = (key, vars) => translate("en", key, vars);

const local = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();

const minute = 60_000;

const hour = 60 * minute;

const view = (extra: Partial<ScheduledTaskView> = {}): ScheduledTaskView => ({
  id: "task_1",
  chat_id: "chat_1",
  prompt: "Check the heat.",
  interval: "1h",
  enabled: true,
  choice: { model: "openai/gpt-sol", effort: "high", pro: false },
  mode: "auto",
  created_at: "2026-11-04T08:00:00.000Z",
  updated_at: "2026-11-04T08:00:00.000Z",
  next_run_at: "2026-11-04T09:00:00.000Z",
  last_run: null,
  runs: [],
  name: "Heat",
  project_path: "",
  running: false,
  ...extra,
});

const run = (result: TaskRun["result"], started_at = "2026-11-04T08:00:00.000Z"): TaskRun => ({ message_id: "m1", started_at, ended_at: result === null ? null : "2026-11-04T08:01:00.000Z", result, error: null });

test("a clock label is the time on the same day, weekday and time within six days, and the date further away, on a 24 hour clock", () => {
  const now = new Date(2026, 10, 4, 12, 0).getTime();
  assert.equal(clock_label(local(4, 14), now, "en"), "14:00");
  assert.equal(clock_label(local(4, 9, 5), now, "de"), "09:05");
  assert.equal(clock_label(local(5, 9), now, "en"), "Thu 09:00");
  assert.equal(clock_label(local(5, 9), now, "de"), "Do. 09:00");
  assert.equal(clock_label(local(1, 18), now, "en"), "Sun 18:00");
  assert.equal(clock_label(local(12, 9), now, "en"), "12 Nov 09:00");
  assert.equal(clock_label(local(12, 9), now, "de"), "12. Nov. 09:00");
});

test("the dial counts down in rounded-up minutes, then whole hours, then whole days, and says now once the time is reached", () => {
  assert.equal(dial_text(t, 0), "now");
  assert.equal(dial_text(t, -5 * minute), "now");
  assert.equal(dial_text(t, 22 * minute + 1), "23m");
  assert.equal(dial_text(t, 59 * minute), "59m");
  assert.equal(dial_text(t, 59 * minute + 30_000), "1h");
  assert.equal(dial_text(t, hour), "1h");
  assert.equal(dial_text(t, 5 * hour + 59 * minute), "5h");
  assert.equal(dial_text(t, 6 * 24 * hour + 23 * hour), "6d");
});

test("the dial fills as the next run comes closer and stays between empty and full", () => {
  const now = Date.parse("2026-11-04T08:30:00.000Z");
  assert.equal(dial_ratio(view(), now), 0.5);
  assert.equal(dial_ratio(view({ next_run_at: "2026-11-04T08:00:00.000Z" }), now), 1);
  assert.equal(dial_ratio(view({ next_run_at: "2026-11-04T12:00:00.000Z" }), now), 0);
});

test("the soonest task is the enabled task with the earliest next run that is not running", () => {
  const tasks = [
    view({ id: "late", next_run_at: "2026-11-04T12:00:00.000Z" }),
    view({ id: "off", enabled: false, next_run_at: "2026-11-04T08:10:00.000Z" }),
    view({ id: "busy", running: true, next_run_at: "2026-11-04T08:20:00.000Z" }),
    view({ id: "next", next_run_at: "2026-11-04T09:00:00.000Z" }),
  ];
  assert.equal(soonest_id(tasks), "next");
  assert.equal(soonest_id([view({ enabled: false })]), null);
});

test("the trail keeps the last twelve runs and adds the running run on the right", () => {
  const runs: RunMark[] = Array.from({ length: 12 }, (_, index) => ({ started_at: `2026-11-04T${String(index).padStart(2, "0")}:00:00.000Z`, result: index === 4 ? "new" : "quiet" }));
  assert.equal(trail_marks(view({ runs })).length, 12);
  const live = trail_marks(view({ runs, running: true, last_run: run(null, "2026-11-04T12:00:00.000Z") }));
  assert.equal(live.length, 12);
  assert.deepEqual(live.at(-1), { started_at: "2026-11-04T12:00:00.000Z", result: "running" });
  assert.equal(live[0]?.started_at, "2026-11-04T01:00:00.000Z");
  assert.deepEqual(trail_marks(view()), []);
});

test("the footer status, the card state and the dial state follow the run", () => {
  assert.equal(status_kind(view(), false), "never");
  assert.equal(status_kind(view({ last_run: run("quiet") }), false), "quiet");
  assert.equal(status_kind(view({ last_run: run("failed") }), false), "failed");
  assert.equal(status_kind(view({ running: true, last_run: run(null) }), false), "running");
  assert.equal(status_kind(view({ running: true, last_run: run(null) }), true), "waiting");
  assert.equal(card_state(view({ last_run: run("failed") }), false), "failed");
  assert.equal(card_state(view({ last_run: run("new") }), false), "idle");
  assert.equal(card_state(view({ running: true, last_run: run(null) }), true), "waiting");
  assert.equal(dial_state(view({ enabled: false }), false), "off");
  assert.equal(dial_state(view({ enabled: false, running: true, last_run: run(null) }), false), "running");
  assert.equal(dial_state(view(), false), "idle");
});

test("the page lists enabled tasks first, each group oldest first", () => {
  const tasks = [
    view({ id: "b", created_at: "2026-11-02T00:00:00.000Z" }),
    view({ id: "paused", enabled: false, created_at: "2026-11-01T00:00:00.000Z" }),
    view({ id: "a", created_at: "2026-11-01T00:00:00.000Z" }),
  ];
  assert.deepEqual([...tasks].sort(page_order).map((task) => task.id), ["a", "b", "paused"]);
});
