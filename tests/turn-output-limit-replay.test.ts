import assert from "node:assert/strict";
import { test } from "node:test";
import { build_api_messages } from "../electron/turn/history.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import { completed, harness, model, transcript } from "./turn-loop-harness.ts";

test("output limit replay preserves the exact continuation between assistant rounds", async () => {
  let calls = 0;
  const run = harness(async (_request, callbacks) => {
    calls += 1;
    callbacks.on_text(calls === 1 ? "first" : "second");
    return calls === 1 ? completed({ content: "first", finish_reason: "length" }) : completed({ content: "second" });
  }, []);
  await run_turn_loop(run.session, run.messages);
  const out = await build_api_messages({ system: "s", messages: [transcript(run.events)], summary: null, model, agent_tools: false });
  assert.deepEqual(out, run.messages);
});

test("each consecutive length finish retains one continuation in the original order", async () => {
  let calls = 0;
  const run = harness(async (_request, callbacks) => {
    const text = `part ${++calls}`;
    callbacks.on_text(text);
    return completed({ content: text, finish_reason: calls < 4 ? "length" : "stop" });
  }, []);
  await run_turn_loop(run.session, run.messages);
  const out = await build_api_messages({ system: "s", messages: [transcript(run.events)], summary: null, model, agent_tools: false });
  assert.deepEqual(out, run.messages);
  assert.equal(out.filter((message) => message.role === "user").length, 3);
});

test("normal rounds and context trimming do not introduce continuation instructions", async () => {
  const run = harness(async (_request, callbacks) => { callbacks.on_text("done"); return completed({ content: "done" }); }, []);
  await run_turn_loop(run.session, run.messages);
  const answer = transcript(run.events);
  answer.steps.push({ id: "trim", kind: "notice", round: 0, notice: "context_trimmed", text: "" });
  const out = await build_api_messages({ system: "s", messages: [answer], summary: null, model, agent_tools: false });
  assert.deepEqual(out, run.messages);
});
