import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelEntry } from "../shared/models.ts";
import { review_request_text } from "../electron/turn/review-request.ts";

const model: ModelEntry = {
  id: "vendor/model",
  label: "Model",
  provider: "p",
  provider_order: [],
  efforts: [],
  default_effort: "",
  vision: false,
  context_length: 1_048_576,
  max_output: 65_536,
  reasoning_passback: false,
};

const changes = review_request_text(null, model);

test("the diff goes in whole and the size rule names the reviewer's real window, compaction point and output limit", () => {
  assert.match(changes, /Put in the whole diff\. The reviewer runs on your model: its context window is 1,048,576 tokens, and the app compacts its conversation once it reaches 734,003 tokens/);
  assert.match(changes, /one response of yours \(at most 65,536 tokens of output\)/);
  assert.match(changes, /name the files left out, so the reviewer reads them from the project files/);
  assert.match(changes, /Each tool result is cut at 25,000 tokens, so collect a larger diff in parts/);
  assert.doesNotMatch(changes, /100,?000 characters/);
  const limited = review_request_text(null, { ...model, context_length: 200_000, compact_at: 0.5, max_output: 8192 });
  assert.match(limited, /its context window is 200,000 tokens, and the app compacts its conversation once it reaches 100,000 tokens/);
  assert.match(limited, /at most 8,192 tokens of output/);
});
