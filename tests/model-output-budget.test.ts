import assert from "node:assert/strict";
import { test } from "node:test";
import { measure_request, output_budget, sent_estimate } from "../electron/context/calibration.ts";
import { affordable_tokens, min_affordable_tokens, ModelError } from "../electron/model/errors.ts";
import { set_key_source } from "../electron/model/key.ts";
import { round_body } from "../electron/model/stream.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import { chunk, model, run } from "./model-stream-harness.ts";

set_key_source(() => "sk-or-test-key");

const short: ApiMessage[] = [{ role: "user", content: "hi" }];

const sized = (target_tokens: number): ApiMessage[] => {
  const per_word = sent_estimate([{ role: "user", content: "word ".repeat(10000) }], [], model) / 10000;
  return [{ role: "user", content: "word ".repeat(Math.round(target_tokens / per_word)) }];
};

const done = [{ data: chunk({ content: "ok" }, "stop") }];

const afford = (n: number) => ({ status: 402, text: JSON.stringify({ error: { code: 402, message: `This request requires more credits, or fewer max_tokens. You requested up to 8000 tokens, but can only afford ${n}.` } }) });

test("the output budget is the model maximum while the context window has room for it", () => {
  assert.equal(output_budget(short, [], model, null), model.max_output);
});

test("the output budget shrinks to the room left in the context window and is dropped when almost none is left", () => {
  const long = sized((model.context_length - model.max_output / 2) / 1.05);
  const room = model.context_length - Math.ceil(sent_estimate(long, [], model) * 1.05);
  assert.ok(room > 1024 && room < model.max_output, String(room));
  assert.equal(output_budget(long, [], model, null), room);
  const full = sized((model.context_length - 512) / 1.05);
  assert.equal(output_budget(full, [], model, null), undefined);
});

test("the output budget leaves room for the calibrated prompt, not the raw estimate", () => {
  const ling = { ...model, context_length: 262_144, max_output: 235_929 };
  const messages = sized(100_000);
  const raw = sent_estimate(messages, [], ling);
  const calibration = { prompt_tokens: 180_000, estimate: 100_000 };
  const calibrated = measure_request(messages, [], ling, calibration);
  assert.ok(calibrated > raw * 1.7, String(calibrated));
  const budget = output_budget(messages, [], ling, calibration);
  assert.equal(budget, ling.context_length - Math.ceil(calibrated * 1.05));
  assert.ok(calibrated + Number(budget) <= ling.context_length);
  assert.equal(output_budget(messages, [], ling, null), Math.min(ling.max_output, ling.context_length - Math.ceil(raw * 1.05)));
  assert.equal(output_budget(short, [], ling, calibration), ling.max_output);
});

test("the request body carries max_tokens only when the round sets one", () => {
  assert.equal(round_body({ model, effort: "high", messages: short, tools: [], max_tokens: 8000 }).max_tokens, 8000);
  assert.ok(!("max_tokens" in round_body({ model, effort: "high", messages: short, tools: [] })));
});

test("the affordable token count is read only from a credits error", () => {
  assert.equal(affordable_tokens(new ModelError("credits", "OpenRouter 402: ... but can only afford 13877. To increase, visit ...", 402)), 13877);
  assert.equal(affordable_tokens(new ModelError("credits", "OpenRouter 402: Insufficient credits", 402)), null);
  assert.equal(affordable_tokens(new ModelError("rate_limited", "can only afford 13877", 429)), null);
});

test("a 402 that names an affordable output size sends the same round again with that size", async () => {
  const outcome = await run([afford(5000), { frames: done }], { max_tokens: 8000 });
  assert.equal(outcome.error, null);
  assert.equal(outcome.posts, 2);
  assert.deepEqual(outcome.bodies.map((body) => JSON.parse(body).max_tokens), [8000, 5000]);
  assert.equal(outcome.result?.content, "ok");
});

test("a 402 below the minimum useful size, or without a size, still fails as a credits error", async () => {
  const tiny = await run([afford(min_affordable_tokens - 1), { frames: done }], { max_tokens: 8000 });
  assert.equal(tiny.error?.kind, "credits");
  assert.equal(tiny.posts, 1);
  const plain = await run([{ status: 402, text: JSON.stringify({ error: { code: 402, message: "Insufficient credits" } }) }, { frames: done }], { max_tokens: 8000 });
  assert.equal(plain.error?.kind, "credits");
  assert.equal(plain.posts, 1);
});
