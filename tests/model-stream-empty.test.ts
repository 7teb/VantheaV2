import assert from "node:assert/strict";
import { test } from "node:test";
import { set_key_source } from "../electron/model/key.ts";
import { chunk, run, sse, write_spec } from "./model-stream-harness.ts";

set_key_source(() => "sk-or-test-key");

const ended = (finish_reason: string, native_finish_reason: string, delta: Record<string, unknown> = { content: "" }) => ({
  data: `${sse({ id: "gen-1", choices: [{ index: 0, delta, finish_reason, native_finish_reason }] })}data: [DONE]\n\n`,
});

const answer = { frames: [{ data: chunk({ content: "fixed" }, "stop") }] };

test("an empty answer the provider marks as malformed is sent again and the next answer is kept", async () => {
  const done = await run([{ frames: [ended("stop", "MALFORMED_RESPONSE")] }, answer]);
  assert.equal(done.error, null);
  assert.equal(done.result?.content, "fixed");
  assert.equal(done.posts, 2);
  assert.deepEqual(done.log, ["retry:2/9:empty_answer", "text:fixed"]);
  assert.equal(done.bodies[0], done.bodies[1]);
});

test("finish reason error and an unexpected tool call count as broken too, also when reasoning came along", async () => {
  const error_finish = await run([{ frames: [ended("error", "")] }, answer]);
  assert.equal(error_finish.result?.content, "fixed");
  assert.equal(error_finish.posts, 2);
  const unexpected = await run([{ frames: [ended("stop", "UNEXPECTED_TOOL_CALL")] }, answer]);
  assert.equal(unexpected.posts, 2);
  const thought = await run([{ frames: [ended("stop", "MALFORMED_FUNCTION_CALL", { reasoning: "plan" })] }, answer]);
  assert.equal(thought.result?.content, "fixed");
  assert.equal(thought.posts, 2);
});

test("an empty answer with a normal stop, and text or a tool call under a malformed finish, end the round as before", async () => {
  const silent = await run([{ frames: [ended("stop", "STOP")] }]);
  assert.equal(silent.result?.status, "completed");
  assert.equal(silent.result?.content, "");
  assert.equal(silent.posts, 1);
  const worded = await run([{ frames: [{ data: chunk({ content: "kept" }) }, ended("stop", "MALFORMED_RESPONSE")] }]);
  assert.equal(worded.result?.content, "kept");
  assert.equal(worded.posts, 1);
  const call = { index: 0, id: "c1", type: "function", function: { name: "write_file", arguments: "{}" } };
  const called = await run([{ frames: [ended("tool_calls", "MALFORMED_FUNCTION_CALL", { tool_calls: [call] })] }], { tools: [write_spec] });
  assert.equal(called.result?.tool_calls.length, 1);
  assert.equal(called.posts, 1);
});

test("a broken answer on every attempt fails as empty_answer and names both finish reasons", async () => {
  const never = await run([{ frames: [ended("stop", "MALFORMED_RESPONSE")] }], { transport: { max_attempts: 2 } });
  assert.equal(never.result, null);
  assert.equal(never.error?.kind, "empty_answer");
  assert.match(never.error?.message ?? "", /finish reason stop, provider reason MALFORMED_RESPONSE/);
  assert.equal(never.posts, 2);
});
