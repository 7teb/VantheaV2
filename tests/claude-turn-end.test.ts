import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApprovalDecision } from "../shared/approval.ts";
import type { SteerMessage } from "../shared/chat.ts";
import { set_claude_runtime } from "../electron/claude/runtime.ts";
import type { Tool } from "../electron/tools/types.ts";
import type { TurnSession } from "../electron/turn/session.ts";
import { run_claude_turn } from "../electron/turn/claude/drive.ts";
import {
  claude_harness,
  ends,
  fake_runtime,
  init,
  make_tool,
  open_steps,
  rate_limit,
  result,
  settle,
  start,
  test_hooks,
  text_block,
  text_delta,
  text_response,
  tool_response,
  transcript,
  until,
} from "./claude-turn-kit.ts";

const begin = (tools: Tool[] = [], over: Partial<TurnSession> = {}) => {
  const fake = fake_runtime();
  set_claude_runtime(fake.runtime);
  const h = claude_harness(tools, over);
  const done = run_claude_turn(h.session, h.input);
  return { fake, h, done };
};

const settled = (events: Parameters<typeof transcript>[0]) => {
  assert.equal(ends(events).length, 1);
  assert.deepEqual(open_steps(events), []);
  const message = transcript(events);
  assert.notEqual(message.status, "streaming");
  return message;
};

test("a finished answer ends done once and closes the query", async () => {
  const { fake, h, done } = begin();
  const query = await fake.opened();
  query.send(init(), ...text_response("m1", "All good"), result());
  await done;
  assert.equal(settled(h.events).status, "done");
  assert.equal(query.closed, true);
  assert.equal(query.interrupts, 0);
});

test("stop in the middle of a streamed answer ends stopped once, interrupts and closes", async () => {
  const { fake, h, done } = begin();
  const query = await fake.opened();
  query.send(init(), start("m1"), text_block(0), text_delta(0, "Partial"));
  await until(() => h.events.some((event) => event.type === "text"), "streamed text");
  h.controller.abort();
  await done;
  assert.equal(settled(h.events).status, "stopped");
  assert.deepEqual(ends(h.events), [{ type: "end", status: "stopped", error: null }]);
  assert.equal(query.interrupts, 1);
  assert.equal(query.closed, true);
  assert.equal(h.stream_calls(), 0);
});

test("an app quit keeps the interrupted end that is emitted right after the abort", async () => {
  const { fake, h, done } = begin();
  const query = await fake.opened();
  query.send(init(), start("m1"), text_block(0), text_delta(0, "Working"));
  await until(() => h.events.some((event) => event.type === "text"), "streamed text");
  const app_closed = { kind: "app_closed" as const, message: "The app was closed while this turn was still running." };
  h.controller.abort(new Error(app_closed.message));
  h.session.emit({ type: "end", status: "interrupted", error: app_closed });
  await done;
  assert.deepEqual(ends(h.events), [{ type: "end", status: "interrupted", error: app_closed }]);
  assert.deepEqual(open_steps(h.events), []);
  assert.equal(query.closed, true);
  assert.equal(query.interrupts, 1);
});

test("stop while a tool runs ends stopped and leaves no running step", async () => {
  let started = false;
  const slow = make_tool("slow", async ({ ctx }) => {
    started = true;
    await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve(), { once: true }));
    throw new Error("the signal stopped the tool");
  });
  const { fake, h, done } = begin([slow]);
  const query = await fake.opened();
  query.send(init(), ...tool_response("m1", [{ id: "tu-1", name: "slow", input: {} }]));
  const call = query.call("slow", {}, "tu-1");
  await until(() => started, "tool start");
  h.controller.abort();
  await done;
  assert.equal((await call).text, "The turn was stopped.");
  const message = settled(h.events);
  assert.equal(message.status, "stopped");
  const step = message.steps.find((entry) => entry.kind === "tool");
  assert.equal(step?.kind === "tool" && step.status, "cancelled");
});

test("stop during an approval wait ends stopped and the card does not stay open", async () => {
  const asking = make_tool("ask_me", async ({ ctx }) => {
    await ctx.approve({ kind: "memory", action: "remember", text: "x" });
    return { status: "done", text: "approved", view: null };
  });
  let waiting = false;
  const wait_decision = (): Promise<ApprovalDecision> => {
    waiting = true;
    return new Promise((resolve) => h.controller.signal.addEventListener("abort", () => resolve({ approved: false, grant: "once", feedback: "" }), { once: true }));
  };
  const fake = fake_runtime();
  set_claude_runtime(fake.runtime);
  const h = claude_harness([asking], { mode: "ask", wait_decision });
  const done = run_claude_turn(h.session, h.input);
  const query = await fake.opened();
  query.send(init(), ...tool_response("m1", [{ id: "tu-1", name: "ask_me", input: {} }]));
  const call = query.call("ask_me", {}, "tu-1");
  await until(() => waiting, "approval wait");
  assert.ok(h.events.some((event) => event.type === "tool_approval"));
  h.controller.abort();
  await done;
  assert.equal((await call).is_error, true);
  const message = settled(h.events);
  assert.equal(message.status, "stopped");
  const step = message.steps.find((entry) => entry.kind === "tool");
  assert.equal(step?.kind === "tool" && step.status, "cancelled");
  assert.equal(step?.kind === "tool" && step.approval, null);
});

const plan_tool = make_tool("present_plan", async () => ({ status: "done", text: "Plan presented to the user.", view: null }));

test("a presented plan ends the turn done without reading on", async () => {
  const { fake, h, done } = begin([plan_tool], { plan: true });
  const query = await fake.opened();
  await query.next_push();
  query.send(init(), ...tool_response("m1", [{ id: "tu-1", name: "present_plan", input: { plan: "Step 1" } }], "Here is the plan."));
  await query.call("present_plan", { plan: "Step 1" }, "tu-1");
  await done;
  assert.equal(settled(h.events).status, "done");
  assert.equal(query.pushed.length, 1);
  assert.equal(query.closed, true);
});

test("a steer that waits when the plan is presented continues the turn", async () => {
  const steers: SteerMessage[] = [];
  const { fake, h, done } = begin([plan_tool], {
    plan: true,
    steers: {
      next: () => steers[0] ?? null,
      noted: async () => [],
      take: () => {
        steers.shift();
      },
    },
  });
  const query = await fake.opened();
  await query.next_push();
  query.send(init(), ...tool_response("m1", [{ id: "tu-1", name: "present_plan", input: {} }]));
  steers.push({ id: "steer-1", text: "Also cover tests", at: 5, attachments: [] });
  await query.call("present_plan", {}, "tu-1");
  const pushed = await query.next_push();
  assert.equal(pushed.priority, "next");
  assert.match(JSON.stringify(pushed.message.content), /Also cover tests/);
  query.send(...text_response("m2", "Updated plan"), result({ user_message_uuids: [pushed.uuid] }));
  await done;
  assert.equal(settled(h.events).status, "done");
  assert.deepEqual(h.events.find((event) => event.type === "steer"), { type: "steer", round: 1, text: "Also cover tests", pushed_at: 5, steer_id: "steer-1" });
});

test("a blocked usage limit event ends the turn at once with claude_limit and the reset time", async () => {
  const { fake, h, done } = begin();
  const query = await fake.opened();
  query.send(init(), rate_limit({ status: "rejected", rateLimitType: "five_hour", resetsAt: 1_900_000_000 }));
  await done;
  const message = settled(h.events);
  assert.equal(message.status, "failed");
  assert.equal(message.error?.kind, "claude_limit");
  assert.match(message.error?.message ?? "", /limit five_hour, resets at \d{4}-\d\d-\d\d \d\d:\d\d/);
  assert.equal(query.closed, true);
});

test("a process that exits without a result ends failed with claude_process", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const { fake, h, done } = begin();
  const query = await fake.opened();
  query.stderr = "fatal startup problem";
  query.send(init());
  query.finish();
  await done;
  const message = settled(h.events);
  assert.equal(message.status, "failed");
  assert.deepEqual(message.error, { kind: "claude_process", message: "Claude Code did not start or exited early: the process ended without a result" });
});

test("an iteration that throws ends failed with claude_process naming the error", async (t) => {
  const errors = t.mock.method(console, "error", () => undefined);
  const { fake, h, done } = begin();
  const query = await fake.opened();
  query.stderr = "panic in native code";
  query.send(init(), start("m1"));
  query.crash(new Error("Claude Code process exited with code 3"));
  await done;
  const message = settled(h.events);
  assert.deepEqual(message.error, { kind: "claude_process", message: "Claude Code did not start or exited early: Claude Code process exited with code 3" });
  assert.ok(errors.mock.calls.some((call) => String(call.arguments[0]).includes("panic in native code")));
});

test("a runtime that cannot open ends failed with claude_process", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const fake = fake_runtime();
  fake.open_error = new Error("Native CLI binary for win32-x64 not found");
  set_claude_runtime(fake.runtime);
  const h = claude_harness([]);
  await run_claude_turn(h.session, h.input);
  const message = settled(h.events);
  assert.deepEqual(message.error, { kind: "claude_process", message: "Claude Code did not start or exited early: Native CLI binary for win32-x64 not found" });
});

test("a turn whose signal is already aborted ends stopped without opening Claude Code", async () => {
  const fake = fake_runtime();
  set_claude_runtime(fake.runtime);
  const h = claude_harness([]);
  h.controller.abort();
  await run_claude_turn(h.session, h.input);
  assert.deepEqual(ends(h.events), [{ type: "end", status: "stopped", error: null }]);
  assert.equal(fake.queries.length, 0);
});

test("a stop hook failure path runs StopFailure before the single end event", async () => {
  const order: string[] = [];
  const hooks = test_hooks({
    stop_failure: async (round, error) => {
      order.push(`stop_failure ${round} ${error.kind}`);
    },
  });
  const { fake, h, done } = begin([], {
    hooks,
    emit: (body) => {
      order.push(body.type);
      h.events.push(body);
    },
  });
  const query = await fake.opened();
  query.send(init("sess-1", "ANTHROPIC_API_KEY"));
  await done;
  assert.deepEqual(order.slice(-2), ["stop_failure 0 claude_auth", "end"]);
  assert.equal(fake.auth_failures(), 1);
});

test("a tool still running when Claude Code exits without a result is aborted and the turn returns only after it ended", async (t) => {
  t.mock.method(console, "error", () => undefined);
  let started = false;
  let finished = false;
  const slow = make_tool("slow", async ({ ctx }) => {
    started = true;
    await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve(), { once: true }));
    await settle(5);
    finished = true;
    throw new Error("the signal stopped the tool");
  });
  const { fake, h, done } = begin([slow]);
  const query = await fake.opened();
  query.send(init(), ...tool_response("m1", [{ id: "tu-1", name: "slow", input: {} }]));
  const call = query.call("slow", {}, "tu-1");
  await until(() => started, "tool start");
  query.finish();
  await done;
  assert.equal(finished, true);
  assert.equal(h.controller.signal.aborted, false);
  assert.equal((await call).text, "The turn was stopped.");
  const message = settled(h.events);
  assert.equal(message.status, "failed");
  assert.equal(message.error?.kind, "claude_process");
});

test("an approval card still open when Claude Code crashes is withdrawn through the call's signal and the turn returns", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const asking = make_tool("ask_me", async ({ ctx }) => {
    await ctx.approve({ kind: "memory", action: "remember", text: "x" });
    return { status: "done", text: "approved", view: null };
  });
  let waiting = false;
  const wait_decision: TurnSession["wait_decision"] = (_call_id, _request, _on_hold, signal): Promise<ApprovalDecision> => {
    waiting = true;
    return new Promise((resolve) => signal.addEventListener("abort", () => resolve({ approved: false, grant: "once", feedback: "" }), { once: true }));
  };
  const fake = fake_runtime();
  set_claude_runtime(fake.runtime);
  const h = claude_harness([asking], { mode: "ask", wait_decision });
  const done = run_claude_turn(h.session, h.input);
  const query = await fake.opened();
  query.send(init(), ...tool_response("m1", [{ id: "tu-1", name: "ask_me", input: {} }]));
  const call = query.call("ask_me", {}, "tu-1");
  await until(() => waiting, "approval wait");
  query.crash(new Error("Claude Code process exited with code 3221225477"));
  await done;
  assert.equal(h.controller.signal.aborted, false);
  assert.equal((await call).text, "The turn was stopped.");
  const message = settled(h.events);
  assert.equal(message.error?.kind, "claude_process");
});
