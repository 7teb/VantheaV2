import assert from "node:assert/strict";
import { test } from "node:test";
import type { HumanDecision } from "../shared/approval.ts";
import type { ReviewActor, ReviewRecord } from "../shared/review.ts";
import { decision_feed } from "../electron/permissions/review-lines.ts";
import { review_statuses } from "../electron/permissions/review-prompt.ts";

const main: ReviewActor = { id: "main", name: "main", kind: "main" };

const record: ReviewRecord = {
  id: "rev-1",
  at: 1,
  actor: main,
  tool: "run_command",
  subject: "git push",
  cwd: ".",
  verdict: "review",
  source: "model",
  reason: "Pushes to the remote.",
  rule_source: "none",
  rule: "",
  last_human_id: null,
};

const answer = (expired: boolean): HumanDecision => ({
  id: `dec-${expired}`,
  at: 2,
  actor: "main",
  tool: "run_command",
  subject: "git push",
  cwd: ".",
  approved: false,
  grant: "once",
  feedback: "",
  reason: record.reason,
  review_id: record.id,
  ...(expired ? { expired: true } : {}),
});

const status_of = (decision: HumanDecision, records: ReviewRecord[]) => decision_feed({ records, decisions: [decision], steps: [] }, main, null, (key) => `d_${key}`)[0]?.status;

test("a card skipped without an answer reaches the review as not answered, not as a user denial", () => {
  assert.equal(status_of(answer(true), [record]), review_statuses.unanswered);
  assert.equal(status_of(answer(true), []), review_statuses.unanswered);
  assert.equal(status_of(answer(false), [record]), review_statuses.user_denied);
});
