import assert from "node:assert/strict";
import { test } from "node:test";
import { measure_request, output_budget, sent_estimate } from "../electron/context/calibration.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import { run_compaction_turn, run_turn_loop } from "../electron/turn/loop.ts";
import { is_note_call, recording } from "./turn-compaction-harness.ts";
import { completed, ends, harness, model, use_media_root } from "./turn-loop-harness.ts";

use_media_root();

const ling = { ...model, context_length: 262_144, max_output: 235_929 };

const calibration = { prompt_tokens: 180_000, estimate: 100_000 };

const sized_history = (raw_tokens: number): ApiMessage[] => {
  const base: ApiMessage[] = [{ role: "system", content: "s" }, { role: "user", instruction: true, content: "" }];
  const per_char = (sent_estimate([{ role: "user", content: "r".repeat(40_000) }], [], ling) - sent_estimate([{ role: "user", content: "" }], [], ling)) / 40_000;
  const missing = raw_tokens - sent_estimate(base, [], ling);
  return [base[0] as ApiMessage, { role: "user", instruction: true, content: "r".repeat(Math.round(missing / per_char)) }];
};

test("a round leaves output room for the calibrated prompt, so prompt plus max_tokens fits the window", async () => {
  const { calls, stream } = recording(() => completed({ content: "done" }));
  const h = harness(stream, []);
  h.session.model = ling;
  h.session.stored_context = { calibration, floor: 0 };
  const api = sized_history(100_000);
  const calibrated = measure_request(api, [], ling, calibration);
  await run_turn_loop(h.session, api);
  assert.equal(calls.length, 1);
  assert.ok(!h.events.some((event) => event.type === "compaction"));
  const max_tokens = Number(calls[0]?.request.max_tokens);
  assert.ok(calibrated >= 179_000 && calibrated < ling.context_length * 0.7, String(calibrated));
  assert.ok(max_tokens <= ling.context_length - Math.ceil(calibrated * 1.05), String(max_tokens));
  assert.ok(calibrated + max_tokens <= ling.context_length);
  assert.equal(ends(h.events)[0]?.type === "end" && ends(h.events)[0]?.status, "done");
});

test("without a stored calibration the round budget is the raw estimate budget as before", async () => {
  const { calls, stream } = recording(() => completed({ content: "done" }));
  const h = harness(stream, []);
  h.session.model = ling;
  const api = sized_history(100_000);
  const raw = sent_estimate(api, [], ling);
  await run_turn_loop(h.session, api);
  assert.equal(calls[0]?.request.max_tokens, Math.min(ling.max_output, ling.context_length - Math.ceil(raw * 1.05)));
});

test("the compaction note request uses the calibrated budget", async () => {
  const { calls, stream } = recording(() => completed({ content: "TASK: t" }));
  const h = harness(stream, []);
  h.session.model = ling;
  h.session.stored_context = { calibration, floor: 0 };
  h.session.compaction = { audience: "user", facts: async () => "", save: async () => undefined, sleep: async () => undefined };
  await run_compaction_turn(h.session, sized_history(100_000));
  const note = calls.find((call) => is_note_call(call.request));
  assert.ok(note);
  const calibrated_budget = output_budget(note.request.messages, note.request.tools, ling, calibration);
  assert.equal(note.request.max_tokens, calibrated_budget);
  assert.ok(Number(calibrated_budget) < Number(output_budget(note.request.messages, note.request.tools, ling, null)));
  assert.ok(measure_request(note.request.messages, note.request.tools, ling, calibration) + Number(note.request.max_tokens) <= ling.context_length);
  assert.equal(ends(h.events)[0]?.type === "end" && ends(h.events)[0]?.status, "done");
});
