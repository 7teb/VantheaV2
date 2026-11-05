import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelError } from "../electron/model/errors.ts";
import { ToolFailureError } from "../electron/tools/types.ts";
import type { RoundResult } from "../electron/model/types.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import { api_call_id } from "../electron/turn/round.ts";
import type { StreamFn } from "../electron/turn/session.ts";
import { completed, ends, harness, make_tool, tool_call, transcript, use_media_root } from "./turn-loop-harness.ts";

use_media_root();

test("a plain answer round ends exactly once as done", async () => {
  const h = harness(async () => completed({ content: "hello", finish_reason: "stop" }), []);
  await run_turn_loop(h.session, h.messages);
  const end = ends(h.events);
  assert.equal(end.length, 1);
  assert.equal(end[0]?.type === "end" && end[0].status, "done");
});

test("a tool that throws still ends exactly once as done", async () => {
  let call = 0;
  const stream: StreamFn = async () => {
    call += 1;
    return call === 1 ? completed({ tool_calls: [tool_call("boom")], finish_reason: "tool_calls" }) : completed({ content: "recovered" });
  };
  const boom = make_tool("boom", async () => {
    throw new Error("kaboom");
  });
  const h = harness(stream, [boom]);
  await run_turn_loop(h.session, h.messages);
  assert.equal(ends(h.events).length, 1);
  const tool_end = h.events.find((event) => event.type === "tool_end");
  assert.equal(tool_end?.type === "tool_end" && tool_end.status, "failed");
});

test("a failure code of a failed tool reaches tool_end, from a result or from a thrown error, and a done result carries none", async () => {
  let call = 0;
  const stream: StreamFn = async () => {
    call += 1;
    return call === 1 ? completed({ tool_calls: [tool_call("missing"), tool_call("thrown"), tool_call("fine")], finish_reason: "tool_calls" }) : completed({ content: "ok" });
  };
  const missing = make_tool("missing", async () => ({ status: "failed", text: "a.ts does not exist in the project", view: null, failure: { kind: "not_in_project", path: "a.ts" } }));
  const thrown = make_tool("thrown", async () => {
    throw new ToolFailureError("Path is outside the project folder", { kind: "outside_project", path: "../x.md" });
  });
  const fine = make_tool("fine", async () => ({ status: "done", text: "ok", view: null, failure: { kind: "web_no_key" } }));
  const h = harness(stream, [missing, thrown, fine]);
  await run_turn_loop(h.session, h.messages);
  const failures = h.events.flatMap((event) => (event.type === "tool_end" ? [[event.status, event.failure ?? null, event.error]] : []));
  assert.deepEqual(failures, [
    ["failed", { kind: "not_in_project", path: "a.ts" }, "a.ts does not exist in the project"],
    ["failed", { kind: "outside_project", path: "../x.md" }, "Path is outside the project folder"],
    ["done", null, null],
  ]);
});

test("aborting during a tool ends exactly once as stopped", async () => {
  const stream: StreamFn = async () => completed({ tool_calls: [tool_call("slow")], finish_reason: "tool_calls" });
  const h = harness(stream, []);
  const slow = make_tool("slow", async () => {
    h.controller.abort(new Error("stop"));
    throw new Error("aborted");
  });
  h.session.resolve_tools = () => [slow];
  await run_turn_loop(h.session, h.messages);
  const end = ends(h.events);
  assert.equal(end.length, 1);
  assert.equal(end[0]?.type === "end" && end[0].status, "stopped");
});

test("a ModelError ends exactly once, policy blocked and transport interrupted", async () => {
  const policy = harness(async () => {
    throw new ModelError("policy", "blocked by provider");
  }, []);
  await run_turn_loop(policy.session, policy.messages);
  assert.equal(ends(policy.events).length, 1);
  assert.equal(ends(policy.events)[0]?.type === "end" && ends(policy.events)[0]?.status, "blocked");

  const transport = harness(async () => {
    throw new ModelError("provider_unavailable", "down");
  }, []);
  await run_turn_loop(transport.session, transport.messages);
  assert.equal(ends(transport.events).length, 1);
  assert.equal(ends(transport.events)[0]?.type === "end" && ends(transport.events)[0]?.status, "interrupted");
});

test("a length finish continues once then ends done", async () => {
  let call = 0;
  const stream: StreamFn = async () => {
    call += 1;
    return call === 1 ? completed({ content: "part", finish_reason: "length" }) : completed({ content: "done", finish_reason: "stop" });
  };
  const h = harness(stream, []);
  await run_turn_loop(h.session, h.messages);
  assert.equal(call, 2);
  assert.equal(ends(h.events).length, 1);
  assert.equal(h.events.some((event) => event.type === "notice" && event.notice === "output_limit"), true);
});

test("present_plan ends the turn after its result", async () => {
  let call = 0;
  const stream: StreamFn = async () => {
    call += 1;
    return completed({ tool_calls: [tool_call("present_plan")], finish_reason: "tool_calls" });
  };
  const present = make_tool("present_plan", async () => ({ status: "done", text: "planned", view: { kind: "plan", text: "do it" } }));
  const h = harness(stream, [present], true);
  await run_turn_loop(h.session, h.messages);
  assert.equal(call, 1);
  assert.equal(ends(h.events).length, 1);
  assert.equal(ends(h.events)[0]?.type === "end" && ends(h.events)[0]?.status, "done");
});

test("arguments that are not valid JSON fail the call without running the tool", async () => {
  let ran = false;
  let call = 0;
  const stream: StreamFn = async () => {
    call += 1;
    if (call > 1) {
      return completed({ content: "retried" });
    }
    return completed({ tool_calls: [{ index: 0, id: "p0", name: "write", arguments: '{"path":"a.txt","content":"cut of' }], finish_reason: "length" });
  };
  const write = make_tool("write", async () => {
    ran = true;
    return { status: "done", text: "ok", view: null };
  });
  const h = harness(stream, [write]);
  await run_turn_loop(h.session, h.messages);
  assert.equal(ran, false);
  const tool_end = h.events.find((event) => event.type === "tool_end");
  assert.equal(tool_end?.type === "tool_end" && tool_end.status, "failed");
  assert.match(tool_end?.type === "tool_end" ? tool_end.result_text : "", /not a valid JSON object/);
  const assistant = h.messages.find((message) => message.role === "assistant" && Boolean(message.tool_calls?.length));
  assert.equal(assistant?.role === "assistant" ? assistant.tool_calls?.[0]?.function.arguments : "", "{}");
});

test("tool_call uses the provider index and API ids are scoped to the turn", async () => {
  let call = 0;
  const stream: StreamFn = async (_request, callbacks) => {
    call += 1;
    if (call > 1) {
      return completed({ content: "ok" });
    }
    callbacks.on_tool_draft(2, "noop", { lines: null });
    return completed({ tool_calls: [{ index: 2, id: "p2", name: "noop", arguments: "{}" }], finish_reason: "tool_calls" });
  };
  const h = harness(stream, [make_tool("noop", async () => ({ status: "done", text: "fine", view: null }))]);
  await run_turn_loop(h.session, h.messages);
  const tool_steps = transcript(h.events).steps.filter((step) => step.kind === "tool");
  assert.equal(tool_steps.length, 1);
  assert.equal(tool_steps[0]?.kind === "tool" && tool_steps[0].status, "done");
  const engine_id = tool_steps[0]?.kind === "tool" ? tool_steps[0].call_id : "";
  const assistant = h.messages.find((message) => message.role === "assistant" && Boolean(message.tool_calls?.length));
  const api_id = assistant?.role === "assistant" ? assistant.tool_calls?.[0]?.id : "";
  assert.equal(api_id, api_call_id("m", engine_id));
  assert.ok(h.messages.some((message) => message.role === "tool" && message.tool_call_id === api_id));
});

test("draft updates become tool_draft events and the tool_call takes the drafted step over", async () => {
  let call = 0;
  const stream: StreamFn = async (_request, callbacks) => {
    call += 1;
    if (call > 1) {
      return completed({ content: "ok" });
    }
    callbacks.on_tool_draft(0, "write_file", { lines: 0 });
    callbacks.on_tool_draft(0, "write_file", { lines: 2, delta: "a\nb", path: "x.py" });
    return completed({ tool_calls: [{ index: 0, id: "p0", name: "write_file", arguments: '{"path":"x.py","content":"a\\nb"}' }], finish_reason: "tool_calls" });
  };
  const h = harness(stream, [make_tool("write_file", async () => ({ status: "done", text: "ok", view: null }))]);
  await run_turn_loop(h.session, h.messages);
  assert.deepEqual(
    h.events.filter((event) => event.type === "tool_draft"),
    [
      { type: "tool_draft", round: 0, index: 0, name: "write_file", lines: 0 },
      { type: "tool_draft", round: 0, index: 0, name: "write_file", lines: 2, delta: "a\nb", path: "x.py" },
    ],
  );
  const tool_steps = transcript(h.events).steps.filter((step) => step.kind === "tool");
  assert.equal(tool_steps.length, 1);
  assert.deepEqual(tool_steps[0]?.kind === "tool" && [tool_steps[0].status, tool_steps[0].progress, tool_steps[0].args], ["done", null, { path: "x.py", content: "a\nb" }]);
});

test("a tool round passes its reasoning back as text when the provider sent no reasoning_details", async () => {
  const details: unknown[] = [{ type: "reasoning.text", text: "plan", index: 0 }];
  const cases: [Partial<RoundResult>, Record<string, unknown>][] = [
    [{ reasoning: "plan" }, { reasoning: "plan" }],
    [{ reasoning: "plan", reasoning_details: details }, { reasoning_details: details }],
  ];
  for (const [over, expected] of cases) {
    let call = 0;
    const stream: StreamFn = async () => {
      call += 1;
      return call > 1 ? completed({ content: "ok" }) : completed({ ...over, content: "Fixing it:", tool_calls: [tool_call("noop")], finish_reason: "tool_calls" });
    };
    const h = harness(stream, [make_tool("noop", async () => ({ status: "done", text: "fine", view: null }))]);
    await run_turn_loop(h.session, h.messages);
    const assistant = h.messages.find((message) => message.role === "assistant" && Boolean(message.tool_calls?.length));
    const sent = assistant?.role === "assistant" ? { reasoning: assistant.reasoning, reasoning_details: assistant.reasoning_details } : null;
    assert.deepEqual(sent, { reasoning: undefined, reasoning_details: undefined, ...expected });
    const stored = h.events.filter((event) => event.type === "reasoning_details");
    assert.deepEqual(stored, over.reasoning_details ? [{ type: "reasoning_details", round: 0, details }] : []);
  }
});

const gated = make_tool("gated", async (ctx) => {
  const decision = await ctx.approve({ kind: "memory", action: "remember", text: "x" });
  return decision.approved ? { status: "done", text: "ran", view: null } : { status: "denied", text: "denied", view: null };
});

const gated_stream = (): StreamFn => {
  let call = 0;
  return async () => {
    call += 1;
    return call === 1 ? completed({ tool_calls: [tool_call("gated")], finish_reason: "tool_calls" }) : completed({ content: "after" });
  };
};

test("an answered approval moves the call back to running and clears the card", async () => {
  const h = harness(gated_stream(), [gated]);
  await run_turn_loop(h.session, h.messages);
  const at = h.events.findIndex((event) => event.type === "tool_approval");
  assert.equal(h.events[at + 1]?.type, "tool_decision");
  assert.equal(h.events[at + 2]?.type, "tool_start");
  const step = transcript(h.events.slice(0, at + 3)).steps.find((entry) => entry.kind === "tool");
  assert.equal(step?.kind === "tool" && step.status, "running");
  assert.equal(step?.kind === "tool" && step.approval, null);
  assert.equal(step?.kind === "tool" && step.decisions?.length, 1);
});

test("an approval the full window granted runs the call and is recorded as a full-window decision", async () => {
  const h = harness(gated_stream(), [gated]);
  h.session.wait_decision = async () => ({ approved: true, grant: "full_window", feedback: "" });
  await run_turn_loop(h.session, h.messages);
  const step = transcript(h.events).steps.find((entry) => entry.kind === "tool");
  assert.equal(step?.kind === "tool" && step.status, "done");
  const decisions = step?.kind === "tool" ? (step.decisions ?? []) : [];
  assert.deepEqual(decisions.map((entry) => [entry.approved, entry.grant]), [[true, "full_window"]]);
});

test("stopping during an approval cancels the call instead of recording a denial", async () => {
  const h = harness(gated_stream(), [gated]);
  h.session.wait_decision = async () => {
    h.controller.abort(new Error("the user stopped the turn"));
    return { approved: false, grant: "once", feedback: "" };
  };
  await run_turn_loop(h.session, h.messages);
  assert.equal(h.events.some((event) => event.type === "tool_end"), false);
  assert.equal(ends(h.events)[0]?.type === "end" && ends(h.events)[0]?.status, "stopped");
  const step = transcript(h.events).steps.find((entry) => entry.kind === "tool");
  assert.equal(step?.kind === "tool" && step.status, "cancelled");
});
