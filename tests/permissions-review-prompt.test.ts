import assert from "node:assert/strict";
import { test } from "node:test";
import { review_response_format, review_schema } from "../electron/permissions/review-answer.ts";
import { blocking_statuses, review_headers, review_system_prompt } from "../electron/permissions/review-prompt.ts";

test("the prompt names every section header the request can carry", () => {
  const headers = Object.values(review_headers);
  assert.equal(headers.length, 14);
  for (const header of headers) {
    assert.ok(review_system_prompt.includes(`- ${header}:`), header);
  }
});

test("the prompt names every blocking status and the D5 anchor", () => {
  for (const status of blocking_statuses) {
    assert.ok(review_system_prompt.includes(`"${status}"`), status);
  }
  assert.match(review_system_prompt, /human_spoke_since/);
});

test("the answer schema is strict with decision as the last required key", () => {
  assert.equal(review_response_format.type, "json_schema");
  assert.equal(review_response_format.json_schema.strict, true);
  assert.equal(review_response_format.json_schema.name, "command_review");
  const keys = Object.keys(review_schema.properties);
  assert.deepEqual(keys, ["rule_source", "rule", "workaround_of", "script_summary", "reason", "decision"]);
  assert.deepEqual(review_schema.required, keys);
  assert.equal(review_schema.additionalProperties, false);
  assert.deepEqual((review_schema.properties.decision as { enum: string[] }).enum, ["allow", "review", "deny"]);
  const keywords = new Set(Object.values(review_schema.properties).flatMap((value) => Object.keys(value as object)));
  assert.deepEqual([...keywords].sort(), ["description", "enum", "type"]);
  assert.equal((review_schema.properties.reason as { description: string }).description, "One or two short sentences, at most 400 characters, read by the user and the agent: the concrete target and effect, and why. In the language of the human's recent messages; English when they write English.");
});
