import assert from "node:assert/strict";
import { test } from "node:test";
import { set_claude_runtime } from "../electron/claude/runtime.ts";
import { run_claude_turn } from "../electron/turn/claude/drive.ts";
import {
  assistant,
  block_stop,
  claude_harness,
  delta,
  ends,
  fake_runtime,
  init,
  json_delta,
  make_tool,
  open_steps,
  raw_tool_block,
  result,
  start,
  stop,
  system,
  text_block,
  text_delta,
  text_response,
  thinking_block,
  thinking_delta,
  tool_block,
  tool_result,
  tool_use,
  transcript,
  until,
} from "./claude-turn-kit.ts";

const begin = (tools = [make_tool("read", async () => ({ status: "done", text: "file text", view: null }))]) => {
  const fake = fake_runtime();
  set_claude_runtime(fake.runtime);
  const h = claude_harness(tools);
  const done = run_claude_turn(h.session, h.input);
  return { fake, h, done };
};

test("a text answer maps to text, usage and context events and ends done without session.stream", async () => {
  const { fake, h, done } = begin();
  const query = await fake.opened();
  await query.next_push();
  query.send(init(), ...text_response("m1", "Hello there"), result());
  await done;
  const types = h.events.map((event) => event.type);
  assert.deepEqual(types, ["text", "usage", "context", "end"]);
  assert.deepEqual(h.events[0], { type: "text", round: 0, delta: "Hello there" });
  assert.deepEqual(h.events[1], { type: "usage", round: 0, prompt_tokens: 125, completion_tokens: 40, reasoning_tokens: 0, cached_tokens: 20, cache_write_tokens: 5 });
  assert.deepEqual(h.events[2], { type: "context", usage: { used: 165, limit: 1_000_000, floor: 0 } });
  assert.deepEqual(h.events[3], { type: "end", status: "done", error: null });
  assert.equal(h.stream_calls(), 0);
  assert.equal(JSON.stringify(h.events).includes("cost"), false);
  assert.deepEqual(h.saved, [{ session_id: "sess-1", cwd: "C:/project", through_message_id: "turn-1" }]);
  assert.deepEqual(h.api_messages.at(-1), { role: "assistant", content: "Hello there" });
  assert.equal(query.closed, true);
});

test("thinking deltas become reasoning, and text that only the snapshot carries is emitted once", async () => {
  const { fake, h, done } = begin();
  const query = await fake.opened();
  query.send(
    init(),
    start("m1"),
    thinking_block(0),
    thinking_delta(0, "Considering"),
    assistant("m1", [{ type: "thinking", thinking: "Considering the file" }]),
    block_stop(0),
    text_block(1),
    assistant("m1", [{ type: "text", text: "Answer only in the snapshot" }]),
    block_stop(1),
    delta("end_turn"),
    stop(),
    result(),
  );
  await done;
  const reasoning = h.events.filter((event) => event.type === "reasoning");
  assert.deepEqual(reasoning, [
    { type: "reasoning", round: 0, delta: "Considering" },
    { type: "reasoning", round: 0, delta: " the file" },
  ]);
  assert.deepEqual(h.events.filter((event) => event.type === "text"), [{ type: "text", round: 0, delta: "Answer only in the snapshot" }]);
  assert.equal(h.events.some((event) => event.type === "reasoning_details"), false);
  assert.deepEqual(h.api_messages.at(-1), { role: "assistant", content: "Answer only in the snapshot", reasoning: "Considering the file" });
});

test("rounds count per API response, an api_retry targets the next round and a restarted response reuses its round", async () => {
  const { fake, h, done } = begin();
  const query = await fake.opened();
  query.send(
    init(),
    system("api_retry", { attempt: 1, max_retries: 10, retry_delay_ms: 500, error_status: 529, error: "overloaded" }),
    start("m1"),
    text_block(0),
    text_delta(0, "Cut off"),
    start("m2"),
    text_block(0),
    text_delta(0, "Complete"),
    assistant("m2", [{ type: "text", text: "Complete" }]),
    block_stop(0),
    delta("tool_use"),
    stop(),
  );
  await until(() => h.events.some((event) => event.type === "usage"), "first usage");
  query.send(system("api_retry", { attempt: 2, max_retries: 10, retry_delay_ms: 1000, error_status: null, error: "server_error" }), ...text_response("m3", "Second round"), result());
  await done;
  const retries = h.events.filter((event) => event.type === "retry");
  assert.deepEqual(retries, [
    { type: "retry", round: 0, attempt: 1, max: 10, reason: "overloaded", wait_ms: 500 },
    { type: "retry", round: 0, attempt: 1, max: 1, reason: "response restarted", wait_ms: 0 },
    { type: "retry", round: 1, attempt: 2, max: 10, reason: "server_error", wait_ms: 1000 },
  ]);
  const texts = transcript(h.events).steps.flatMap((step) => (step.kind === "text" ? [`${step.round}:${step.text}`] : []));
  assert.deepEqual(texts, ["0:Complete", "1:Second round"]);
  assert.deepEqual(h.events.filter((event) => event.type === "usage").map((event) => event.type === "usage" && event.round), [0, 1]);
});

test("an api_retry inside an unfinished round is the only retry for that round when the response restarts", async () => {
  const { fake, h, done } = begin();
  const query = await fake.opened();
  query.send(
    init(),
    start("m1"),
    text_block(0),
    text_delta(0, "Half"),
    system("api_retry", { attempt: 1, max_retries: 3, retry_delay_ms: 200, error_status: 500, error: "server_error" }),
    ...text_response("m2", "Whole"),
    result(),
  );
  await done;
  assert.deepEqual(
    h.events.filter((event) => event.type === "retry"),
    [{ type: "retry", round: 0, attempt: 1, max: 3, reason: "server_error", wait_ms: 200 }],
  );
  assert.deepEqual(transcript(h.events).steps.flatMap((step) => (step.kind === "text" ? [step.text] : [])), ["Whole"]);
});

test("supersedes drops the replaced round and keeps the replacement", async () => {
  const { fake, h, done } = begin();
  const query = await fake.opened();
  query.send(
    init(),
    start("m1"),
    text_block(0),
    text_delta(0, "Refused attempt"),
    assistant("m1", [{ type: "text", text: "Refused attempt" }], { uuid: "u-refused" }),
    block_stop(0),
    delta("refusal"),
    stop(),
    start("m2"),
    text_block(0),
    text_delta(0, "Fallback answer"),
    assistant("m2", [{ type: "text", text: "Fallback answer" }], { supersedes: ["u-refused"] }),
    block_stop(0),
    delta("end_turn"),
    stop(),
    result(),
  );
  await done;
  assert.deepEqual(h.events.filter((event) => event.type === "retry"), [{ type: "retry", round: 0, attempt: 1, max: 1, reason: "response replaced", wait_ms: 0 }]);
  assert.deepEqual(transcript(h.events).steps.flatMap((step) => (step.kind === "text" ? [`${step.round}:${step.text}`] : [])), ["1:Fallback answer"]);
  assert.equal(ends(h.events)[0].type === "end" && ends(h.events)[0].status, "done");
});

test("input deltas of a drafted tool become tool_draft events with the bare name", async () => {
  const write = make_tool("write_file", async () => ({ status: "done", text: "written", view: null }), false, {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
  });
  const { fake, h, done } = begin([write]);
  const query = await fake.opened();
  const input = { path: "a.txt", content: "one\ntwo" };
  query.send(init(), start("m1"), tool_block(0, "tu-1", "write_file"), json_delta(0, '{"path":"a.txt","content":"one'), json_delta(0, '\\ntwo"}'));
  await until(() => h.events.some((event) => event.type === "tool_draft"), "draft");
  query.send(assistant("m1", [tool_use("tu-1", "write_file", input)]), block_stop(0), delta("tool_use"), stop());
  const called = await query.call("write_file", input, "tu-1");
  assert.equal(called.text, "written");
  query.send(...text_response("m2", "Done"), result());
  await done;
  const drafts = h.events.filter((event) => event.type === "tool_draft");
  assert.ok(drafts.length >= 1);
  assert.ok(drafts.every((event) => event.type === "tool_draft" && event.name === "write_file" && event.round === 0 && event.index === 0));
  const call = h.events.find((event) => event.type === "tool_call");
  assert.deepEqual(call, { type: "tool_call", round: 0, index: 0, call_id: "c0_0", name: "write_file", args: input });
  const step = transcript(h.events).steps.find((entry) => entry.kind === "tool");
  assert.equal(step?.kind === "tool" && step.status, "done");
});

test("a tool_use that Claude Code answers without a handler run is closed as failed with that text", async () => {
  const { fake, h, done } = begin();
  const query = await fake.opened();
  query.send(
    init(),
    start("m1"),
    tool_block(0, "tu-9", "read"),
    json_delta(0, "{}"),
    assistant("m1", [tool_use("tu-9", "read", {})]),
    block_stop(0),
    delta("tool_use"),
    stop(),
    tool_result("tu-9", "Error: input failed validation"),
    ...text_response("m2", "Recovered"),
    result(),
  );
  await done;
  const end = h.events.find((event) => event.type === "tool_end");
  assert.deepEqual(end, { type: "tool_end", call_id: "c0_0", status: "failed", view: null, error: "Error: input failed validation", result_text: "Error: input failed validation" });
  assert.deepEqual(open_steps(h.events), []);
  const scope_call = h.api_messages.find((message) => message.role === "assistant" && message.tool_calls?.length);
  assert.equal(scope_call?.role === "assistant" && scope_call.tool_calls?.[0].function.name, "read");
  assert.ok(h.api_messages.some((message) => message.role === "tool" && message.content === "Error: input failed validation"));
});

test("EndConversation never gets a row and permission_denied closes its call as denied", async () => {
  const { fake, h, done } = begin();
  const query = await fake.opened();
  query.send(
    init(),
    start("m1"),
    raw_tool_block(0, "tu-end", "EndConversation"),
    assistant("m1", [{ type: "tool_use", id: "tu-end", name: "EndConversation", input: {} }]),
    block_stop(0),
    tool_block(1, "tu-2", "read"),
    assistant("m1", [tool_use("tu-2", "read", { path: "x" })]),
    block_stop(1),
    delta("tool_use"),
    stop(),
    system("permission_denied", { tool_name: "mcp__vantheax__read", tool_use_id: "tu-2", message: "Denied by rule" }),
    ...text_response("m2", "ok"),
    result(),
  );
  await done;
  const calls = h.events.filter((event) => event.type === "tool_call");
  assert.deepEqual(calls.map((event) => event.type === "tool_call" && [event.name, event.call_id]), [["read", "c0_0"]]);
  assert.equal(JSON.stringify(h.events).includes("EndConversation"), false);
  assert.deepEqual(h.events.find((event) => event.type === "tool_end"), { type: "tool_end", call_id: "c0_0", status: "denied", view: null, error: null, result_text: "Denied by rule" });
});

test("an unhandled message type is logged once per query by type and subtype", async (t) => {
  const info = t.mock.method(console, "info", () => undefined);
  const { fake, h, done } = begin();
  const query = await fake.opened();
  query.send(init(), system("thinking_tokens", { estimated_tokens: 5, estimated_tokens_delta: 5 }), system("thinking_tokens", { estimated_tokens: 9, estimated_tokens_delta: 4 }), ...text_response("m1", "x"), result());
  await done;
  const lines = info.mock.calls.map((call) => String(call.arguments[0])).filter((line) => line.includes("system/thinking_tokens"));
  assert.equal(lines.length, 1);
  assert.equal(ends(h.events).length, 1);
});
