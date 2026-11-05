import assert from "node:assert/strict";
import { test } from "node:test";
import { parse_review_command } from "../src/features/composer/review-command.ts";

test("a draft of only /review, optionally with a pull request number, is a review command", () => {
  assert.deepEqual(parse_review_command("/review"), { pr: null });
  assert.deepEqual(parse_review_command("/review 42"), { pr: 42 });
  assert.deepEqual(parse_review_command("/review #42"), { pr: 42 });
  assert.deepEqual(parse_review_command("  /review   7  \n"), { pr: 7 });
  assert.deepEqual(parse_review_command("/review 999999999"), { pr: 999_999_999 });
  assert.deepEqual(parse_review_command("/review 042"), { pr: 42 });
});

test("anything else stays a normal message", () => {
  for (const text of ["/review abc", "/review 42 please", "text /review", "/review 0", "/review -1", "/review 1234567890", "/reviews", "/review#42", "/Review 42", ""]) {
    assert.equal(parse_review_command(text), null, text);
  }
});
