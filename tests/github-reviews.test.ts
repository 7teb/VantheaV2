import assert from "node:assert/strict";
import { test } from "node:test";
import { summarize_reviews } from "../shared/github/reviews.ts";

test("the last approving or blocking review per user counts, comments do not replace it", () => {
  const summary = summarize_reviews(
    [
      { login: "ana", state: "CHANGES_REQUESTED" },
      { login: "ana", state: "APPROVED" },
      { login: "ana", state: "COMMENTED" },
      { login: "ben", state: "APPROVED" },
      { login: "cy", state: "CHANGES_REQUESTED" },
    ],
    [],
    0,
  );
  assert.deepEqual(summary, { approved: 2, changes_requested: 1, pending: 0 });
});

test("a dismissed review cancels what that user said before it, a later review counts again", () => {
  const dismissed = summarize_reviews(
    [
      { login: "ana", state: "APPROVED" },
      { login: "ana", state: "DISMISSED" },
    ],
    [],
    0,
  );
  assert.deepEqual(dismissed, { approved: 0, changes_requested: 0, pending: 0 });
  const later = summarize_reviews(
    [
      { login: "ana", state: "DISMISSED" },
      { login: "ana", state: "CHANGES_REQUESTED" },
    ],
    [],
    0,
  );
  assert.deepEqual(later, { approved: 0, changes_requested: 1, pending: 0 });
});

test("requested reviewers and teams are pending, a re-requested reviewer no longer counts with the old review", () => {
  const summary = summarize_reviews(
    [
      { login: "ana", state: "APPROVED" },
      { login: "ben", state: "APPROVED" },
      { login: null, state: "APPROVED" },
    ],
    ["ben", "dora"],
    1,
  );
  assert.deepEqual(summary, { approved: 1, changes_requested: 0, pending: 3 });
});
