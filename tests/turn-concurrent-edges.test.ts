import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApprovalRequest } from "../shared/approval.ts";
import type { TurnEvent } from "../shared/events.ts";
import { open_chat_window, resolve_decision, wait_for_decision } from "../electron/permissions/approvals.ts";
import { close_full_window } from "../electron/permissions/full-window.ts";
import type { Tool, ToolImage } from "../electron/tools/types.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import { api_call_id } from "../electron/turn/round.ts";
import { mark_event, type ChatMarks } from "../src/state/chat-marks-rules.ts";
import { asked, assert_tool_protocol, calls_of, done, end_status, ended, marks, parallel, scripted, tool_contents, watch } from "./concurrent-kit.ts";
import { ends, harness, make_tool, model, queue_steers, transcript, use_media_root, type Harness } from "./turn-loop-harness.ts";

use_media_root();

const memory: ApprovalRequest = { kind: "memory", action: "remember", text: "x" };

const open_statuses = ["drafting", "queued", "running", "awaiting_approval"];

const real_approvals = (h: Harness, key: string) => {
  h.session.chat_id = key;
  h.session.wait_decision = (call_id, request, on_hold) => wait_for_decision({ key, chat_id: key, call_id, request, signal: h.controller.signal, on_hold });
};

const tool_steps = (h: Harness) => transcript(h.events).steps.flatMap((step) => (step.kind === "tool" ? [step] : []));

const asking = (name: string, request: ApprovalRequest = memory): Tool =>
  parallel(name, async (ctx) => {
    const decision = await ctx.approve(request);
    return decision.approved ? done(`${name} ran`) : { status: "denied", text: `${name} denied: ${decision.feedback}`, view: null };
  });

const turn_events = (h: Harness): TurnEvent[] => h.events.map((body, index) => ({ ...body, seq: index + 1, at: index + 1, chat_id: h.session.chat_id, message_id: "m" }));

const shot = (label: string): ToolImage => ({ bytes: Buffer.from(`png-${label}`), mime: "image/png", label: `[Image ${label}]` });

test("a batch where one call fails, one throws, one is denied and one succeeds answers every call in order and the turn goes on", async () => {
  const { stream, requests } = scripted(calls_of(["fails", "throws", "asks", "works"]));
  const h = harness(stream, []);
  real_approvals(h, "chat-mixed");
  const until = watch(h);
  h.session.resolve_tools = () => [
    parallel("fails", async () => ({ status: "failed", text: "fails broke", view: null })),
    parallel("throws", async () => {
      await until(asked("c0_2"));
      throw new Error("throws broke");
    }),
    asking("asks"),
    parallel("works", async () => {
      await until(ended("c0_1"));
      return done("works result");
    }),
  ];
  void until(ended("c0_3")).then(() => resolve_decision("chat-mixed", "c0_2", { approved: false, grant: "once", feedback: "not now" }));
  await run_turn_loop(h.session, h.messages);
  assert.deepEqual(
    ["c0_0", "c0_1", "c0_2", "c0_3"].map((call_id) => end_status(h.events, call_id)),
    ["failed", "failed", "denied", "done"],
  );
  assert.deepEqual(marks(h.events).filter((mark) => mark.startsWith("end:")), ["end:c0_0", "end:c0_1", "end:c0_3", "end:c0_2"]);
  assert.equal(requests.length, 2);
  assert_tool_protocol(requests[1]);
  assert.deepEqual(tool_contents(requests[1]), ["fails broke", "throws broke", "asks denied: not now", "works result"]);
  assert.equal(ends(h.events).length, 1);
  assert.equal(ends(h.events)[0]?.type === "end" && ends(h.events)[0]?.status, "done");
  assert.equal(tool_steps(h).some((step) => open_statuses.includes(step.status)), false);
});

test("Stop while one call waits for approval and another still runs cancels both, keeps the finished result and leaves no approval behind", async () => {
  const { stream, requests } = scripted(calls_of(["quick", "asks", "slow"]));
  const h = harness(stream, []);
  real_approvals(h, "chat-stop");
  const until = watch(h);
  h.session.resolve_tools = () => [
    parallel("quick", async () => done("quick result")),
    asking("asks"),
    parallel("slow", (ctx) => new Promise((_resolve, reject) => ctx.signal.addEventListener("abort", () => reject(new Error("slow aborted")), { once: true }))),
  ];
  void Promise.all([until(asked("c0_1")), until(ended("c0_0"))]).then(() => h.controller.abort(new Error("the user stopped the turn")));
  await run_turn_loop(h.session, h.messages);
  assert.equal(requests.length, 1);
  const end = ends(h.events);
  assert.equal(end.length, 1);
  assert.equal(end[0]?.type === "end" && end[0].status, "stopped");
  assert.equal(h.events.at(-1)?.type, "end");
  const steps = tool_steps(h);
  assert.deepEqual(
    steps.map((step) => [step.call_id, step.status, step.approval]),
    [
      ["c0_0", "done", null],
      ["c0_1", "cancelled", null],
      ["c0_2", "cancelled", null],
    ],
  );
  assert.equal(steps[0]?.result_text, "quick result");
  assert.deepEqual(
    h.messages.flatMap((message) => (message.role === "tool" ? [message.tool_call_id] : [])),
    [api_call_id("m", "c0_0")],
  );
  assert.equal(resolve_decision("chat-stop", "c0_1", { approved: true, grant: "once", feedback: "" }), false);
  let chat_marks: ChatMarks = {};
  const pending: string[][] = [];
  for (const event of turn_events(h)) {
    chat_marks = mark_event(chat_marks, event, false);
    pending.push(chat_marks["chat-stop"]?.pending ?? []);
  }
  assert.ok(pending.some((ids) => ids.length === 1 && ids[0] === "c0_1"));
  assert.equal(chat_marks["chat-stop"], undefined);
});

test("a steer sent during a batch reaches the model after every tool message of that round", async () => {
  const { stream, requests } = scripted(calls_of(["first", "second"]));
  const h = harness(stream, []);
  const steers = queue_steers(h);
  const until = watch(h);
  h.session.resolve_tools = () => [
    parallel("first", async () => {
      steers.push("use the other file");
      await until(ended("c0_1"));
      return done("first result");
    }),
    parallel("second", async () => done("second result")),
  ];
  await run_turn_loop(h.session, h.messages);
  const next = requests[1];
  assert.ok(next);
  assert_tool_protocol(next);
  const at = next.findIndex((message) => message.role === "assistant" && Boolean(message.tool_calls?.length));
  assert.deepEqual(next.slice(at + 1).map((message) => message.role), ["tool", "tool", "user"]);
  assert.match(JSON.stringify(next[at + 3]), /use the other file/);
  const steer_at = h.events.findIndex((event) => event.type === "steer");
  assert.equal(h.events[steer_at]?.type === "steer" && h.events[steer_at].round, 1);
  assert.ok(h.events.findIndex(ended("c0_0")) < steer_at && h.events.findIndex(ended("c0_1")) < steer_at);
  assert.equal(steers.queued.length, 0);
});

test("images of a mixed batch reach the model in call order in one carrier after the last tool message", async () => {
  const { stream, requests } = scripted(calls_of(["one", "two", "three", "four"]));
  const h = harness(stream, []);
  h.session.model = { ...model, vision: true };
  const until = watch(h);
  h.session.resolve_tools = () => [
    parallel("one", async () => done("one", { images: [shot("1")] })),
    make_tool("two", async () => done("two", { images: [shot("2a"), shot("2b")] })),
    parallel("three", async () => {
      await until(ended("c0_3"));
      return done("three", { images: [shot("3")] });
    }),
    parallel("four", async () => done("four", { images: [shot("4")] })),
  ];
  await run_turn_loop(h.session, h.messages);
  const seen = marks(h.events);
  assert.ok(seen.indexOf("end:c0_0") < seen.indexOf("start:c0_1"));
  assert.ok(seen.indexOf("end:c0_1") < seen.indexOf("start:c0_2"));
  assert.ok(seen.indexOf("end:c0_3") < seen.indexOf("end:c0_2"));
  const next = requests[1];
  assert.ok(next);
  assert_tool_protocol(next);
  const at = next.findIndex((message) => message.role === "assistant" && Boolean(message.tool_calls?.length));
  assert.deepEqual(next.slice(at + 1).map((message) => message.role), ["tool", "tool", "tool", "tool", "user"]);
  const carrier = next[at + 5];
  assert.ok(carrier?.role === "user" && carrier.tool_images && Array.isArray(carrier.content));
  assert.deepEqual(
    carrier.content.flatMap((part) => (part.type === "text" ? [part.text] : [])),
    ["[Image 1]", "[Image 2a]", "[Image 2b]", "[Image 3]", "[Image 4]"],
  );
  assert.equal(next.filter((message) => message.role === "user" && message.tool_images).length, 1);
});

test("calls that ignore Stop and still return in the last batch end the turn as stopped without another model call", async () => {
  const { stream, requests } = scripted(calls_of(["stops", "late"]));
  const h = harness(stream, []);
  const until = watch(h);
  h.session.resolve_tools = () => [
    parallel("stops", async () => {
      h.controller.abort(new Error("stop"));
      return done("stops result");
    }),
    parallel("late", async () => {
      await until(ended("c0_0"));
      return done("late result");
    }),
  ];
  await run_turn_loop(h.session, h.messages);
  assert.equal(requests.length, 1);
  assert.equal(ends(h.events).length, 1);
  assert.equal(ends(h.events)[0]?.type === "end" && ends(h.events)[0]?.status, "stopped");
  assert.deepEqual(tool_steps(h).map((step) => step.status), ["done", "done"]);
});

test("an unknown tool and broken arguments inside a run of concurrent calls are answered in place and split nothing else", async () => {
  const { stream, requests } = scripted(calls_of(["read", "missing", ["read", "{\"path\": "], "read"]));
  const h = harness(stream, [parallel("read", async () => done("read result"))]);
  await run_turn_loop(h.session, h.messages);
  const seen = marks(h.events);
  assert.deepEqual(seen.slice(0, 4), ["start:c0_0", "end:c0_0", "start:c0_1", "end:c0_1"]);
  assert.deepEqual(seen.slice(4, 6), ["start:c0_2", "start:c0_3"]);
  assert.deepEqual(
    ["c0_0", "c0_1", "c0_2", "c0_3"].map((call_id) => end_status(h.events, call_id)),
    ["done", "failed", "failed", "done"],
  );
  const next = requests[1];
  assert.ok(next);
  assert_tool_protocol(next);
  const assistant = next.find((message) => message.role === "assistant" && Boolean(message.tool_calls?.length));
  assert.equal(assistant?.role === "assistant" && assistant.tool_calls?.[2]?.function.arguments, "{}");
  assert.match(tool_contents(next)[1] ?? "", /Unknown tool: missing/);
});

test("a full-window grant also answers the covered approval of a sibling in the same batch", async () => {
  const write: ApprovalRequest = { kind: "write", path: "a.ts", created: false, added: 1, removed: 0, diff: [] };
  const { stream } = scripted(calls_of(["w1", "w2"]));
  const h = harness(stream, [asking("w1", write), asking("w2", write)]);
  real_approvals(h, "chat-window");
  const until = watch(h);
  void Promise.all([until(asked("c0_0")), until(asked("c0_1"))]).then(() => open_chat_window("chat-window"));
  try {
    await run_turn_loop(h.session, h.messages);
  } finally {
    close_full_window("chat-window");
  }
  const steps = tool_steps(h);
  assert.deepEqual(steps.map((step) => step.status), ["done", "done"]);
  assert.deepEqual(steps.map((step) => step.decisions?.map((decision) => decision.grant)), [["full_window"], ["full_window"]]);
});

test("an unexpected failure inside one call still lets its sibling finish and ends the turn once as failed", async () => {
  const { stream, requests } = scripted(calls_of(["breaks", "slow"]));
  const h = harness(stream, []);
  const emit = h.session.emit;
  let broke = false;
  h.session.emit = (body) => {
    if (!broke && body.type === "tool_end" && body.call_id === "c0_0") {
      broke = true;
      throw new Error("message gone");
    }
    emit(body);
  };
  h.session.resolve_tools = () => [
    parallel("breaks", async () => done("breaks result")),
    parallel("slow", async () => {
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      return done("slow result");
    }),
  ];
  await run_turn_loop(h.session, h.messages);
  assert.equal(requests.length, 1);
  const end = ends(h.events);
  assert.equal(end.length, 1);
  assert.equal(end[0]?.type === "end" && end[0].status, "failed");
  assert.equal(end[0]?.type === "end" && end[0].error?.message, "message gone");
  assert.ok(h.events.findIndex(ended("c0_1")) < h.events.findIndex((event) => event.type === "end"));
  assert.deepEqual(tool_steps(h).map((step) => [step.call_id, step.status]), [
    ["c0_0", "cancelled"],
    ["c0_1", "done"],
  ]);
});
