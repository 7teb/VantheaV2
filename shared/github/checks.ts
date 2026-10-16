import type { GithubCheck, GithubCheckState, GithubChecks } from "../github-view.ts";

export type RunStatus = { status: string; conclusion: string | null };

export type CheckRun = { check: GithubCheck; app: string | null };

export type ChecksInput = {
  check_runs: CheckRun[];
  statuses: GithubCheck[];
  workflows: GithubCheck[];
  limited: boolean;
};

export const check_order: readonly GithubCheckState[] = ["failed", "action_required", "running", "passed", "skipped"];

const failing = new Set(["failure", "timed_out", "startup_failure"]);

export const run_state = ({ status, conclusion }: RunStatus): GithubCheckState => {
  if (status !== "completed") return "running";
  if (conclusion === "success") return "passed";
  if (conclusion === "action_required") return "action_required";
  if (conclusion !== null && failing.has(conclusion)) return "failed";
  return "skipped";
};

export const status_state = (state: string): GithubCheckState => {
  if (state === "success") return "passed";
  if (state === "pending") return "running";
  return "failed";
};

const count_states = (checks: GithubCheck[]): Record<GithubCheckState, number> => {
  const counts: Record<GithubCheckState, number> = { failed: 0, action_required: 0, running: 0, passed: 0, skipped: 0 };
  for (const check of checks) counts[check.state] += 1;
  return counts;
};

export const summarize_checks = ({ check_runs, statuses, workflows, limited }: ChecksInput): GithubChecks | null => {
  const counted = [...check_runs.map((run) => run.check), ...statuses];
  const basis = counted.length > 0 ? counted : workflows;
  if (basis.length === 0) {
    return null;
  }
  const counts = count_states(basis);
  const state = check_order.find((entry) => counts[entry] > 0) ?? "skipped";
  const foreign = check_runs.filter((run) => run.app !== "github-actions").map((run) => run.check);
  return { state, counts, items: [...workflows, ...foreign, ...statuses], limited };
};
