import assert from "node:assert/strict";
import { test } from "node:test";
import { measure_request, output_budget, sent_estimate } from "../electron/context/calibration.ts";
import { compaction_request, resume_text } from "../electron/context/compact-text.ts";
import { round_body } from "../electron/model/stream.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import { run_compaction_turn, run_turn_loop } from "../electron/turn/loop.ts";
import type { StreamFn } from "../electron/turn/session.ts";
import { compaction_steps, counted, is_note_call, pad_request, recording, setup, small, type Recorded } from "./turn-compaction-harness.ts";
import { completed, ends, queue_steers, tool_call, use_media_root } from "./turn-loop-harness.ts";

use_media_root();

const mentions = (messages: ApiMessage[], text: string) => messages.some((message) => JSON.stringify(message.content).includes(text));

test("compaction runs between rounds once the measured context passes 70 percent, through the working model with the round's own prefix and no cap", async () => {
  const { calls, stream } = recording((request, call) => {
    if (is_note_call(request)) {
      return completed({ content: "TASK: fix the bug\nNEXT: run the tests" });
    }
    return call === 1 ? completed({ tool_calls: [tool_call("read_file")], finish_reason: "tool_calls", usage: counted(request, 1.2) }) : completed({ content: "fixed" });
  });
  const result = "y".repeat(4000);
  const { h, saved } = setup(stream, result);
  pad_request(h, 20_000);
  const request = h.messages[1]?.content;
  await run_turn_loop(h.session, h.messages);
  assert.equal(calls.length, 3);
  const note_call = calls[1] as Recorded;
  assert.ok(sent_estimate(note_call.messages.slice(0, -1), note_call.request.tools, small) < small.context_length * 0.7);
  const checked = h.events.flatMap((event) => (event.type === "context" ? [event.usage.used] : []));
  assert.ok(checked.some((used) => used > small.context_length * 0.7));
  const round_call = calls[0] as Recorded;
  assert.equal(note_call.request.model, small);
  assert.equal(note_call.request.effort, round_call.request.effort);
  assert.deepEqual(note_call.request.tools, round_call.request.tools);
  assert.deepEqual(note_call.request.tools.map((tool) => tool.name), ["read_file"]);
  assert.equal(note_call.request.tool_choice, undefined);
  assert.deepEqual(note_call.messages.slice(0, round_call.messages.length), round_call.messages);
  const body = round_body(note_call.request);
  assert.equal(body.tool_choice, "auto");
  assert.deepEqual(body.reasoning, round_body(round_call.request).reasoning);
  assert.deepEqual(Object.keys(body).filter((key) => key.startsWith("max")), ["max_tokens"]);
  const calibration = h.events.flatMap((event) => (event.type === "context" && event.usage.calibration ? [event.usage.calibration] : []))[0] ?? null;
  assert.ok(calibration);
  assert.equal(body.max_tokens, output_budget(note_call.request.messages, note_call.request.tools, small, calibration));
  assert.ok(Number(body.max_tokens) >= Math.min(small.max_output, small.context_length - measure_request(note_call.request.messages, note_call.request.tools, small, calibration) * 1.05 - 1));
  assert.equal(note_call.messages.at(-1)?.content, compaction_request("user"));
  assert.ok(note_call.messages.some((message) => message.role === "tool" && message.content === result));
  assert.deepEqual(saved, [{ note: "TASK: fix the bug\nNEXT: run the tests", facts: "Files changed:\n- C:/p/a.ts (+1 -0)", through_round: 0 }]);
  const after = (calls[2] as Recorded).messages;
  assert.equal(after[0]?.role, "system");
  assert.equal(after[1]?.content, `${resume_text("user")}\n\nTASK: fix the bug\nNEXT: run the tests`);
  assert.equal(after[2]?.content, request);
  assert.ok(after.some((message) => message.role === "tool" && message.content === result));
  assert.equal(after.at(-1)?.content, "Files changed:\n- C:/p/a.ts (+1 -0)");
  assert.deepEqual(compaction_steps(h).map(({ round, status, source }) => ({ round, status, source })), [{ round: 1, status: "done", source: "auto" }]);
  assert.equal(ends(h.events)[0]?.type === "end" && ends(h.events)[0]?.status, "done");
});

test("below 70 percent no compaction runs", async () => {
  const { calls, stream } = recording((request, call) =>
    call === 1 ? completed({ tool_calls: [tool_call("read_file")], finish_reason: "tool_calls", usage: counted(request, 1.1) }) : completed({ content: "fixed" }),
  );
  const { h } = setup(stream, "y".repeat(24_000));
  await run_turn_loop(h.session, h.messages);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.request.tool_choice === undefined));
  assert.equal(compaction_steps(h).length, 0);
});

test("a steer taken at the round start is measured before the model call, so the round does not go out above 70 percent", async () => {
  const steer = "s".repeat(4400);
  const { calls, stream } = recording((request, call) => {
    if (is_note_call(request)) {
      return completed({ content: "TASK: t" });
    }
    if (call === 1) {
      steers.push(steer);
      return completed({ tool_calls: [tool_call("read_file")], finish_reason: "tool_calls", usage: counted(request, 1.2) });
    }
    return completed({ content: "fixed" });
  });
  const { h } = setup(stream, "ok");
  pad_request(h, 20_000);
  const steers = queue_steers(h);
  await run_turn_loop(h.session, h.messages);
  assert.equal(calls.length, 3);
  assert.ok(is_note_call((calls[1] as Recorded).request));
  assert.ok(mentions((calls[1] as Recorded).messages, steer));
  assert.ok(mentions((calls[2] as Recorded).messages, steer));
  assert.deepEqual(compaction_steps(h).map((step) => `${step.round}:${step.status}`), ["1:done"]);
});

test("an app note taken at the round start is measured before the model call as well", async () => {
  const note = "n".repeat(4400);
  let pending = false;
  const { calls, stream } = recording((request, call) => {
    if (is_note_call(request)) {
      return completed({ content: "TASK: t" });
    }
    if (call === 1) {
      pending = true;
      return completed({ tool_calls: [tool_call("read_file")], finish_reason: "tool_calls", usage: counted(request, 1.2) });
    }
    return completed({ content: "fixed" });
  });
  const { h } = setup(stream, "ok");
  pad_request(h, 20_000);
  h.session.take_notes = () => {
    if (!pending) {
      return [];
    }
    pending = false;
    return [{ kind: "notice", notice: "agent_report", text: "", content: note }];
  };
  await run_turn_loop(h.session, h.messages);
  assert.equal(calls.length, 3);
  assert.ok(mentions((calls[1] as Recorded).messages, note));
  assert.deepEqual(compaction_steps(h).map((step) => `${step.round}:${step.status}`), ["1:done"]);
});

test("a compaction that lands below 70 percent re-arms the plain 70 percent trigger", async () => {
  let working = 0;
  const { calls, stream } = recording((request) => {
    if (is_note_call(request)) {
      return completed({ content: "TASK: t" });
    }
    working += 1;
    return working <= 4 ? completed({ tool_calls: [tool_call("read_file")], finish_reason: "tool_calls", usage: counted(request, 1.1) }) : completed({ content: "fixed" });
  });
  const { h } = setup(stream, "y".repeat(13_000));
  await run_turn_loop(h.session, h.messages);
  assert.equal(calls.length, 8);
  assert.deepEqual(compaction_steps(h).map((step) => `${step.round}:${step.status}`), ["2:done", "3:done", "4:done"]);
  const kept = (calls[3] as Recorded).messages.filter((message) => message.role === "tool").map((message) => message.content);
  assert.deepEqual(kept, ["y".repeat(13_000)]);
  const floors = h.events.flatMap((event) => (event.type === "context" ? [event.usage.floor] : []));
  assert.ok(floors.every((floor) => floor === 0));
});

test("a message sent while the compaction runs stays out of its request and reaches the model right after it", async () => {
  const { calls, stream } = recording((request, call) => {
    if (is_note_call(request)) {
      steers.push("use the second approach");
      return completed({ content: "TASK: t" });
    }
    return call === 1 ? completed({ tool_calls: [tool_call("read_file")], finish_reason: "tool_calls", usage: counted(request, 1.1) }) : completed({ content: "fixed" });
  });
  const { h } = setup(stream, "ok");
  pad_request(h, 26_000);
  const steers = queue_steers(h);
  await run_turn_loop(h.session, h.messages);
  assert.equal(calls.length, 3);
  assert.equal(mentions((calls[1] as Recorded).messages, "use the second approach"), false);
  const after = (calls[2] as Recorded).messages;
  const steer_at = after.findIndex((message) => message.role === "user" && message.steer && JSON.stringify(message.content).includes("use the second approach"));
  assert.ok(steer_at > 1);
  const done_at = h.events.findIndex((event) => event.type === "compaction" && event.status === "done");
  const steer_event = h.events.findIndex((event) => event.type === "steer" && event.text === "use the second approach");
  assert.ok(done_at >= 0 && steer_event > done_at);
  assert.equal(steers.queued.length, 0);
});

test("the manual compaction turn writes the note through the working model and ends done", async () => {
  const { calls, stream } = recording(() => completed({ content: "TASK: t" }));
  const { h, saved } = setup(stream, "ok");
  await run_compaction_turn(h.session, h.messages);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.request.tool_choice, undefined);
  assert.ok(calls[0] && is_note_call(calls[0].request));
  assert.deepEqual(saved.map((record) => record.through_round), [-1]);
  assert.deepEqual(compaction_steps(h).map(({ round, status, source }) => ({ round, status, source })), [{ round: 0, status: "done", source: "manual" }]);
  assert.equal(h.messages[1]?.content, `${resume_text("user")}\n\nTASK: t`);
  assert.equal(ends(h.events)[0]?.type === "end" && ends(h.events)[0]?.status, "done");
});

test("a model that answers the note request with a tool call is asked once more with tools off and its note is used", async () => {
  const { calls, stream } = recording((request) =>
    request.tool_choice === "none" ? completed({ content: "TASK: t" }) : completed({ content: "Let me check first.", tool_calls: [tool_call("read_file")], finish_reason: "tool_calls" }),
  );
  const { h, saved } = setup(stream, "ok");
  await run_compaction_turn(h.session, h.messages);
  assert.deepEqual(calls.map((call) => call.request.tool_choice), [undefined, "none"]);
  assert.ok(calls.every((call) => is_note_call(call.request)));
  assert.deepEqual(calls[1]?.messages, calls[0]?.messages);
  assert.deepEqual(saved.map((record) => record.note), ["TASK: t"]);
  assert.deepEqual(compaction_steps(h).map(({ status }) => status), ["done"]);
});

test("a manual compaction never continues into an answer, so its line keeps its own id and a waiting message stays for the next turn", async () => {
  const { calls, stream } = recording(() => {
    steers.push("now fix it");
    return completed({ content: "TASK: t" });
  });
  const { h } = setup(stream, "ok");
  const steers = queue_steers(h);
  await run_compaction_turn(h.session, h.messages);
  assert.equal(calls.length, 1);
  assert.deepEqual(steers.queued.map((steer) => steer.text), ["now fix it"]);
  assert.deepEqual(compaction_steps(h).map((step) => `${step.id}:${step.status}`), ["compaction:0:done"]);
  assert.equal(h.events.some((event) => event.type === "steer"), false);
  assert.equal(ends(h.events).length, 1);
});

test("stopping during a compaction ends the turn stopped and settles the line as interrupted", async () => {
  const stream: StreamFn = async (request) => {
    if (is_note_call(request)) {
      h.controller.abort(new Error("stop"));
      return completed({ status: "cancelled" });
    }
    return completed({ tool_calls: [tool_call("read_file")], finish_reason: "tool_calls", usage: counted(request, 1.1) });
  };
  const { h } = setup(stream, "ok");
  pad_request(h, 26_000);
  await run_turn_loop(h.session, h.messages);
  assert.equal(ends(h.events)[0]?.type === "end" && ends(h.events)[0]?.status, "stopped");
  assert.deepEqual(compaction_steps(h).map((step) => step.status), ["interrupted"]);
});
