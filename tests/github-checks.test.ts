import assert from "node:assert/strict";
import { test } from "node:test";
import { run_state, status_state, summarize_checks, type CheckRun } from "../shared/github/checks.ts";
import type { GithubCheck } from "../shared/github-view.ts";

const check = (name: string, state: GithubCheck["state"]): GithubCheck => ({ name, state, url: null, started_at: null, completed_at: null });

const run = (name: string, status: string, conclusion: string | null, app = "github-actions"): CheckRun => ({ check: check(name, run_state({ status, conclusion })), app });

test("check run states follow GitHub's commit symbol", () => {
  assert.equal(run_state({ status: "queued", conclusion: null }), "running");
  assert.equal(run_state({ status: "in_progress", conclusion: null }), "running");
  assert.equal(run_state({ status: "completed", conclusion: "success" }), "passed");
  for (const conclusion of ["failure", "timed_out", "startup_failure"]) assert.equal(run_state({ status: "completed", conclusion }), "failed");
  assert.equal(run_state({ status: "completed", conclusion: "action_required" }), "action_required");
  for (const conclusion of ["neutral", "skipped", "cancelled", "stale"]) assert.equal(run_state({ status: "completed", conclusion }), "skipped");
  assert.equal(status_state("success"), "passed");
  assert.equal(status_state("pending"), "running");
  assert.equal(status_state("failure"), "failed");
  assert.equal(status_state("error"), "failed");
});

test("one failure wins over running and passed checks, action required wins over running", () => {
  const failing = summarize_checks({ check_runs: [run("build", "completed", "success"), run("lint", "in_progress", null), run("test", "completed", "failure")], statuses: [], workflows: [], limited: false });
  assert.equal(failing?.state, "failed");
  assert.deepEqual(failing?.counts, { failed: 1, action_required: 0, running: 1, passed: 1, skipped: 0 });
  const waiting = summarize_checks({ check_runs: [run("deploy", "completed", "action_required"), run("lint", "queued", null)], statuses: [], workflows: [], limited: false });
  assert.equal(waiting?.state, "action_required");
  const running = summarize_checks({ check_runs: [run("lint", "queued", null), run("build", "completed", "success")], statuses: [], workflows: [], limited: false });
  assert.equal(running?.state, "running");
});

test("passed when everything succeeded or was skipped, skipped only when nothing ran", () => {
  const passed = summarize_checks({ check_runs: [run("build", "completed", "success"), run("docs", "completed", "skipped")], statuses: [], workflows: [], limited: false });
  assert.equal(passed?.state, "passed");
  assert.equal(passed?.counts.passed, 1);
  const skipped = summarize_checks({ check_runs: [run("docs", "completed", "skipped")], statuses: [], workflows: [], limited: false });
  assert.equal(skipped?.state, "skipped");
});

test("classic statuses count, a combined pending without statuses is no check at all", () => {
  const pending = summarize_checks({ check_runs: [], statuses: [check("ci/external", status_state("pending"))], workflows: [], limited: false });
  assert.equal(pending?.state, "running");
  assert.equal(summarize_checks({ check_runs: [], statuses: [], workflows: [], limited: false }), null);
});

test("the list shows workflow runs, check runs of other apps and statuses, the counts come from all check runs", () => {
  const checks = summarize_checks({
    check_runs: [run("build (ubuntu)", "completed", "success"), run("build (windows)", "completed", "success"), run("codecov/patch", "completed", "success", "codecov")],
    statuses: [check("ci/external", "passed")],
    workflows: [check("CI", "passed")],
    limited: true,
  });
  assert.deepEqual(
    checks?.items.map((item) => item.name),
    ["CI", "codecov/patch", "ci/external"],
  );
  assert.equal(checks?.counts.passed, 4);
  assert.equal(checks?.limited, true);
});

test("workflow runs without check runs still give a state", () => {
  const checks = summarize_checks({ check_runs: [], statuses: [], workflows: [check("CI", "running")], limited: false });
  assert.equal(checks?.state, "running");
  assert.equal(checks?.counts.running, 1);
});
