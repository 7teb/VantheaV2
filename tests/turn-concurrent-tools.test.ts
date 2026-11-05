import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApprovalDecision, ApprovalRequest } from "../shared/approval.ts";
import type { UserMessage } from "../shared/chat.ts";
import type { StreamEventBody } from "../shared/events.ts";
import type { ApiMessage, RoundToolCall } from "../electron/model/types.ts";
import type { Tool, ToolImage, ToolResult } from "../electron/tools/types.ts";
import { image_url } from "../electron/turn/carriers.ts";
import { build_api_messages } from "../electron/turn/history.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import { api_call_id } from "../electron/turn/round.ts";
import type { StreamFn } from "../electron/turn/session.ts";
import { completed, ends, harness, make_tool, model, transcript, use_media_root, type Harness } from "./turn-loop-harness.ts";

use_media_root();

const done = (text: string, images?: ToolImage[]): ToolResult => ({ status: "done", text, view: null, ...(images ? { images } : {}) });

const parallel = (name: string, run: Tool["execute"]): Tool => ({ ...make_tool(name, run), concurrent: true });

const calls = (names: string[]): RoundToolCall[] => names.map((name, index) => ({ index, id: `p${index}`, name, arguments: "{}" }));

const one_round = (names: string[]) => {
  let rounds = 0;
  const stream: StreamFn = async (_request, callbacks) => {
    rounds += 1;
    if (rounds === 1) {
      return completed({ tool_calls: calls(names), finish_reason: "tool_calls" });
    }
    callbacks.on_text("done");
    return completed({ content: "done" });
  };
  return { stream, rounds: () => rounds };
};

const ended = (call_id: string) => (event: StreamEventBody) => event.type === "tool_end" && event.call_id === call_id;

const watch = (h: Harness) => {
  const waiters: { check: (event: StreamEventBody) => boolean; resolve: () => void }[] = [];
  const emit = h.session.emit;
  h.session.emit = (body) => {
    emit(body);
    for (const waiter of waiters.filter((entry) => entry.check(body))) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  };
  const until = (check: (event: StreamEventBody) => boolean) =>
    new Promise<void>((resolve) => {
      if (h.events.some(check)) {
        resolve();
        return;
      }
      waiters.push({ check, resolve });
    });
  const after_end = async (call_id: string) => {
    await new Promise((resolve) => setImmediate(resolve));
    if (h.events.some((event) => event.type === "tool_start" && event.call_id === call_id)) {
      await until(ended(call_id));
    }
  };
  return { until, after_end };
};

const marks = (events: StreamEventBody[]): string[] =>
  events.flatMap((event) => {
    if (event.type === "tool_start") {
      return [`start:${event.call_id}`];
    }
    if (event.type === "tool_end") {
      return [`end:${event.call_id}`];
    }
    return [];
  });

const end_status = (events: StreamEventBody[], call_id: string) => {
  const event = events.find(ended(call_id));
  return event?.type === "tool_end" ? event.status : null;
};

const id = (call_id: string) => api_call_id("m", call_id);

const tool_ids = (messages: ApiMessage[]) => messages.flatMap((message) => (message.role === "tool" ? [message.tool_call_id] : []));

const vision = { ...model, vision: true };

const shot = (name: string): ToolImage => ({ bytes: Buffer.from(`png-${name}`), mime: "image/png", label: `[Image ${name}]` });

test("consecutive concurrent calls overlap and the turn ends once as done", async () => {
  const { stream } = one_round(["a", "b"]);
  const h = harness(stream, []);
  let release_b = () => {};
  const b_started = new Promise<boolean>((resolve) => {
    release_b = () => resolve(true);
  });
  let overlapped = false;
  const a = parallel("a", async () => {
    overlapped = await Promise.race([b_started, new Promise<boolean>((resolve) => setImmediate(() => resolve(false)))]);
    return done("a result");
  });
  const b = parallel("b", async () => {
    release_b();
    return done("b result");
  });
  h.session.resolve_tools = () => [a, b];
  await run_turn_loop(h.session, h.messages);
  assert.equal(overlapped, true);
  const seen = marks(h.events);
  assert.deepEqual(seen.slice(0, 2), ["start:c0_0", "start:c0_1"]);
  assert.ok(seen.indexOf("start:c0_1") < seen.indexOf("end:c0_0"));
  assert.equal(ends(h.events).length, 1);
  assert.equal(ends(h.events)[0]?.type === "end" && ends(h.events)[0]?.status, "done");
});

test("a later call that finishes first still answers in tool_calls order, right after the assistant message", async () => {
  const { stream } = one_round(["a", "b"]);
  const h = harness(stream, []);
  const { after_end } = watch(h);
  const a = parallel("a", async () => {
    await after_end("c0_1");
    return done("a result");
  });
  const b = parallel("b", async () => done("b result"));
  h.session.resolve_tools = () => [a, b];
  await run_turn_loop(h.session, h.messages);
  assert.deepEqual(marks(h.events).filter((mark) => mark.startsWith("end:")), ["end:c0_1", "end:c0_0"]);
  const assistant = h.messages[1];
  assert.ok(assistant?.role === "assistant");
  assert.deepEqual(assistant.tool_calls?.map((call) => call.id), [id("c0_0"), id("c0_1")]);
  assert.deepEqual(h.messages.slice(2, 4), [
    { role: "tool", tool_call_id: id("c0_0"), content: "a result" },
    { role: "tool", tool_call_id: id("c0_1"), content: "b result" },
  ]);
});

test("images of concurrent calls go into one carrier after both tool messages, in call order", async () => {
  const { stream } = one_round(["a", "b"]);
  const h = harness(stream, []);
  h.session.model = vision;
  const { after_end } = watch(h);
  const a = parallel("a", async () => {
    await after_end("c0_1");
    return done("a result", [shot("a")]);
  });
  const b = parallel("b", async () => done("b result", [shot("b")]));
  h.session.resolve_tools = () => [a, b];
  await run_turn_loop(h.session, h.messages);
  assert.deepEqual(marks(h.events).filter((mark) => mark.startsWith("end:")), ["end:c0_1", "end:c0_0"]);
  const carriers = h.messages.filter((message) => message.role === "user" && message.tool_images);
  assert.equal(carriers.length, 1);
  assert.deepEqual(h.messages.slice(2, 5).map((message) => message.role), ["tool", "tool", "user"]);
  const carrier = h.messages[4];
  assert.ok(carrier?.role === "user" && Array.isArray(carrier.content));
  assert.deepEqual(
    carrier.content.flatMap((part) => (part.type === "text" ? [part.text] : [])),
    ["[Image a]", "[Image b]"],
  );
});

test("a sequential call is a barrier between concurrent calls", async () => {
  const { stream } = one_round(["c1", "s", "c2"]);
  const run = async () => done("ok");
  const h = harness(stream, [parallel("c1", run), make_tool("s", run), parallel("c2", run)]);
  await run_turn_loop(h.session, h.messages);
  assert.deepEqual(marks(h.events), ["start:c0_0", "end:c0_0", "start:c0_1", "end:c0_1", "start:c0_2", "end:c0_2"]);
});

test("Stop during a batch keeps the finished call, cancels the rest and never starts a later batch", async () => {
  const { stream, rounds } = one_round(["a", "b", "c"]);
  const h = harness(stream, []);
  const { until } = watch(h);
  let third_ran = false;
  const a = parallel("a", async () => done("a result"));
  const b = parallel("b", async () => {
    await until(ended("c0_0"));
    h.controller.abort(new Error("stop"));
    throw new Error("aborted");
  });
  const c = make_tool("c", async () => {
    third_ran = true;
    return done("c result");
  });
  h.session.resolve_tools = () => [a, b, c];
  await run_turn_loop(h.session, h.messages);
  const end = ends(h.events);
  assert.equal(end.length, 1);
  assert.equal(end[0]?.type === "end" && end[0].status, "stopped");
  assert.equal(h.events.at(-1)?.type, "end");
  assert.equal(third_ran, false);
  assert.equal(marks(h.events).includes("start:c0_2"), false);
  assert.equal(rounds(), 1);
  const steps = transcript(h.events).steps.flatMap((step) => (step.kind === "tool" ? [step] : []));
  assert.deepEqual(
    steps.map((step) => [step.call_id, step.status]),
    [
      ["c0_0", "done"],
      ["c0_1", "cancelled"],
      ["c0_2", "cancelled"],
    ],
  );
  assert.equal(steps[0]?.result_text, "a result");
  assert.equal(steps.some((step) => ["queued", "running", "awaiting_approval", "drafting"].includes(step.status)), false);
  assert.deepEqual(tool_ids(h.messages), [id("c0_0")]);
});

test("a concurrent call that throws fails on its own while its sibling completes and the loop goes on", async () => {
  const { stream, rounds } = one_round(["a", "b"]);
  const a = parallel("a", async () => {
    throw new Error("kaboom");
  });
  const b = parallel("b", async () => done("b result"));
  const h = harness(stream, [a, b]);
  await run_turn_loop(h.session, h.messages);
  assert.equal(end_status(h.events, "c0_0"), "failed");
  assert.equal(end_status(h.events, "c0_1"), "done");
  assert.deepEqual(tool_ids(h.messages), [id("c0_0"), id("c0_1")]);
  assert.equal(h.messages[2]?.role === "tool" && h.messages[2].content, "kaboom");
  assert.equal(rounds(), 2);
  assert.equal(ends(h.events).length, 1);
  assert.equal(ends(h.events)[0]?.type === "end" && ends(h.events)[0]?.status, "done");
});

test("two concurrent calls can wait for approval at once and each decision reaches only its own call", async () => {
  const { stream } = one_round(["a", "b"]);
  const request: ApprovalRequest = { kind: "memory", action: "remember", text: "x" };
  const asking = (name: string) =>
    parallel(name, async (ctx) => {
      const decision = await ctx.approve(request);
      return decision.approved ? done(`${name} ran`) : { status: "denied", text: `${name} denied`, view: null };
    });
  const h = harness(stream, [asking("a"), asking("b")]);
  const pending = new Map<string, (decision: ApprovalDecision) => void>();
  const settle = () => {
    for (const [call_id, resolve] of pending) {
      resolve({ approved: call_id === "c0_0", grant: "once", feedback: "" });
    }
    pending.clear();
  };
  h.session.wait_decision = (call_id) =>
    new Promise((resolve) => {
      pending.set(call_id, resolve);
      setImmediate(settle);
    });
  await run_turn_loop(h.session, h.messages);
  const first_decision = h.events.findIndex((event) => event.type === "tool_decision");
  const approvals = h.events.flatMap((event, at) => (event.type === "tool_approval" ? [at] : []));
  assert.equal(approvals.length, 2);
  assert.ok(approvals.every((at) => at < first_decision));
  assert.equal(end_status(h.events, "c0_0"), "done");
  assert.equal(end_status(h.events, "c0_1"), "denied");
  for (const call_id of ["c0_0", "c0_1"]) {
    const decided = h.events.findIndex((event) => event.type === "tool_decision" && event.call_id === call_id);
    const starts = h.events.flatMap((event, at) => (event.type === "tool_start" && event.call_id === call_id ? [at] : []));
    assert.equal(starts.length, 2, call_id);
    assert.ok(starts[1] > decided, call_id);
  }
  const later_starts = h.events.slice(first_decision).flatMap((event) => (event.type === "tool_start" ? [event.call_id] : []));
  assert.deepEqual(later_starts.toSorted(), ["c0_0", "c0_1"]);
});

test("the history replayed from the events matches the live request for a batch whose later call finished first", async () => {
  const { stream } = one_round(["a", "b"]);
  const h = harness(stream, []);
  h.session.model = vision;
  const stored = new Map<string, string>();
  h.session.store_images = async (images) =>
    images.map((image) => {
      const key = `img${stored.size}.png`;
      stored.set(key, image_url(image.bytes, image.mime));
      return key;
    });
  const { after_end } = watch(h);
  const a = parallel("a", async () => {
    await after_end("c0_1");
    return done("a result", [shot("a")]);
  });
  const b = parallel("b", async () => done("b result", [shot("b")]));
  h.session.resolve_tools = () => [a, b];
  await run_turn_loop(h.session, h.messages);
  assert.deepEqual(marks(h.events).filter((mark) => mark.startsWith("end:")), ["end:c0_1", "end:c0_0"]);
  const user = (message_id: string, text: string): UserMessage => ({ id: message_id, role: "user", text, attachments: [], origin: "user", created_at: "2026-10-30T10:00:00.000Z" });
  const replayed = await build_api_messages(
    { system: "s", summary: null, messages: [user("u1", "go"), transcript(h.events), user("u2", "next")], model: vision, agent_tools: true },
    async (key) => stored.get(key) ?? "",
  );
  assert.deepEqual(tool_ids(replayed), [id("c0_0"), id("c0_1")]);
  assert.deepEqual(replayed.slice(2, -1), h.messages.slice(1));
});
