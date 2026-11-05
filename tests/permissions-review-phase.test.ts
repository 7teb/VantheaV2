import assert from "node:assert/strict";
import { test } from "node:test";
import { apply_events } from "../shared/apply-event.ts";
import type { AssistantMessage, PermissionMode, ToolProgress } from "../shared/chat.ts";
import type { StreamEventBody } from "../shared/events.ts";
import type { ModelEntry } from "../shared/models.ts";
import type { Settings } from "../shared/settings.ts";
import type { RoundResult } from "../electron/model/types.ts";
import { under_review } from "../electron/permissions/command-review.ts";
import { mcp_command_gate } from "../electron/permissions/mcp-gate.ts";
import { decide, set_command_gate, type McpCall } from "../electron/tools/mcp/decide.ts";
import { mcp_review } from "../electron/tools/mcp/overseer.ts";
import { gate_command } from "../electron/tools/shell/gate.ts";
import type { Tool, ToolContext } from "../electron/tools/types.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import type { StreamFn, TurnSession } from "../electron/turn/session.ts";
import { answer, main_review_actor, review_stub, type ReviewStub } from "./review-stub.ts";
import { set_storage_root } from "../electron/storage/paths.ts";
import { tool_model } from "./tool-model.ts";

set_storage_root("C:\\Users\\user\\AppData\\Roaming\\VantheaX");

type Probe = { ctx: ToolContext; controller: AbortController; progress: ToolProgress[]; phase_now: () => string | undefined };

let contexts = 0;

const probe = (stub: ReviewStub, mode: PermissionMode = "auto", extra: Partial<ToolContext> = {}): Probe => {
  const controller = new AbortController();
  const progress: ToolProgress[] = [];
  const ctx: ToolContext = {
    chat_id: `review-phase-${(contexts += 1)}`,
    turn_id: "turn",
    call_id: "call",
    project_root: "",
    user_request: "run the tests",
    mode,
    profile: "main",
    model: tool_model,
    image_fit: [],
    settings: { custom_instructions: "" } as ToolContext["settings"],
    signal: controller.signal,
    progress: (entry) => progress.push(entry),
    approve: async () => ({ approved: true, grant: "once", feedback: "" }),
    side_model: async () => "",
    review: stub,
    message_main: null, send_peer: null, context: () => ({ used: 0, limit: 0, compact_at: null }),
    ...extra,
  };
  return { ctx, controller, progress, phase_now: () => progress.at(-1)?.phase };
};

const phases = (p: Probe) => p.progress.map((entry) => entry.phase ?? "none");

const watch_call = (stub: ReviewStub, p: Probe, seen: string[]) => {
  const call = stub.call;
  stub.call = async (request, signal) => {
    seen.push(p.phase_now() ?? "none");
    return call(request, signal);
  };
};

const abort_on_call = (stub: ReviewStub, p: Probe) => {
  stub.call = async () => {
    p.controller.abort(new Error("stopped by the user"));
    throw new Error("request aborted");
  };
};

test("an auto-mode command review sets the review phase before the model call and clears it after", async () => {
  const stub = review_stub([answer("allow")]);
  const p = probe(stub);
  const seen: string[] = [];
  watch_call(stub, p, seen);
  assert.equal((await gate_command(p.ctx, "git status --short", "", false)).kind, "run");
  assert.deepEqual(seen, ["review"]);
  assert.deepEqual(phases(p), ["review", "none"]);
});

test("a failed review call clears the phase before the approval card asks", async () => {
  const stub = review_stub([new Error("socket hang up")]);
  let phase_at_card = "unset";
  const p = probe(stub, "auto", {
    approve: async () => {
      phase_at_card = p.phase_now() ?? "none";
      return { approved: true, grant: "once", feedback: "" };
    },
  });
  assert.equal((await gate_command(p.ctx, "git status --short", "", false)).kind, "run");
  assert.equal(phase_at_card, "none");
  assert.deepEqual(phases(p), ["review", "none"]);
});

test("an error thrown inside the review clears the phase and still propagates", async () => {
  const stub = review_stub([answer("allow")], main_review_actor, async () => {
    throw new Error("history unreadable");
  });
  const p = probe(stub);
  await assert.rejects(gate_command(p.ctx, "git status --short", "", false), /history unreadable/);
  assert.deepEqual(phases(p), ["review", "none"]);
});

test("aborting during the review call clears the phase", async () => {
  const stub = review_stub();
  const p = probe(stub);
  abort_on_call(stub, p);
  await assert.rejects(gate_command(p.ctx, "git status --short", "", false), /request aborted/);
  assert.deepEqual(phases(p), ["review", "none"]);
});

test("ask and full mode never show the review phase", async () => {
  const asked = probe(review_stub(), "ask");
  assert.equal((await gate_command(asked.ctx, "git status --short", "", false)).kind, "run");
  assert.deepEqual(asked.progress, []);
  const full = probe(review_stub(), "full");
  assert.equal((await gate_command(full.ctx, "git status --short", "", false)).kind, "run");
  assert.deepEqual(full.progress, []);
});

test("an auto-mode floor block never shows the review phase", async () => {
  const stub = review_stub();
  const p = probe(stub);
  const seen: string[] = [];
  watch_call(stub, p, seen);
  assert.equal((await gate_command(p.ctx, "format c:", "", false)).kind, "block");
  assert.equal((await gate_command(p.ctx, "   ", "", false)).kind, "block");
  assert.deepEqual(seen, []);
  assert.deepEqual(p.progress, []);
});

test("entering the review twice in one scope sets and clears the phase once", async () => {
  const p = probe(review_stub());
  assert.equal(
    await under_review(p.ctx, async (enter) => {
      enter();
      enter();
      return "ok";
    }),
    "ok",
  );
  assert.deepEqual(phases(p), ["review", "none"]);
  assert.equal(await under_review(p.ctx, async () => "skipped"), "skipped");
  assert.deepEqual(phases(p), ["review", "none"]);
});

const mcp_call = (extra: Partial<McpCall> = {}): McpCall => ({ server: "ce", tool: "write_memory", tier: "state_change", args: { address: "0x10" }, scope: null, trusted: false, ...extra });

test("an auto-mode MCP review sets the phase around the model call", async () => {
  const stub = review_stub([answer("deny", "patches the game")]);
  const p = probe(stub);
  const seen: string[] = [];
  watch_call(stub, p, seen);
  assert.equal((await decide(mcp_call(), p.ctx, mcp_review)).kind, "denied");
  assert.deepEqual(seen, ["review"]);
  assert.deepEqual(phases(p), ["review", "none"]);
});

test("an aborted MCP review clears the phase, and ask mode never sets it", async () => {
  const stub = review_stub();
  const p = probe(stub);
  abort_on_call(stub, p);
  await assert.rejects(decide(mcp_call(), p.ctx, mcp_review), /request aborted/);
  assert.deepEqual(phases(p), ["review", "none"]);
  const asked = probe(review_stub(), "ask");
  assert.equal((await decide(mcp_call(), asked.ctx, mcp_review)).kind, "ask");
  assert.deepEqual(asked.progress, []);
});

test("an MCP shell call shows the phase through the command gate", async () => {
  set_command_gate(mcp_command_gate);
  const stub = review_stub([answer("allow")]);
  const p = probe(stub);
  const seen: string[] = [];
  watch_call(stub, p, seen);
  assert.equal((await decide(mcp_call({ tool: "shell", tier: "shell_system", args: { command: "git status --short" } }), p.ctx, mcp_review)).kind, "run");
  assert.deepEqual(seen, ["review"]);
  assert.deepEqual(phases(p), ["review", "none"]);
});

const model: ModelEntry = { id: "m", label: "M", provider: "p", provider_order: [], efforts: ["high"], default_effort: "high", vision: false, context_length: 1_000_000, max_output: 4096, reasoning_passback: false };

const completed = (over: Partial<RoundResult>): RoundResult => ({ status: "completed", content: "", reasoning: "", reasoning_details: [], tool_calls: [], finish_reason: "stop", usage: null, ...over });

const run_tool = async (execute: Tool["execute"], review = review_stub()): Promise<StreamEventBody[]> => {
  let round = 0;
  const stream: StreamFn = async () => {
    round += 1;
    return round === 1 ? completed({ tool_calls: [{ index: 0, id: "p0", name: "probe", arguments: "{}" }], finish_reason: "tool_calls" }) : completed({ content: "done" });
  };
  const events: StreamEventBody[] = [];
  const session: TurnSession = {
    compaction: { audience: "user", facts: async () => "" },
    chat_id: `review-phase-turn-${(contexts += 1)}`,
    message_id: "m",
    user_request: "run the tests",
    project_root: "",
    settings: {} as Settings,
    model,
    effort: "high",
    mode: "auto",
    plan: false,
    signal: new AbortController().signal,
    emit: (body) => events.push(body),
    stream,
    resolve_tools: () => [{ spec: { name: "probe", description: "", parameters: { type: "object", properties: {} } }, profiles: ["main"], available: () => true, execute }],
    side_model: async () => "",
    review,
    wait_decision: async () => ({ approved: true, grant: "once", feedback: "" }),
  };
  await run_turn_loop(session, [{ role: "system", content: "s" }]);
  return events;
};

const progress_events = (events: StreamEventBody[]) => events.flatMap((event) => (event.type === "tool_progress" ? [event.progress] : []));

test("the progress throttle passes every phase change without using up the throttle window", async () => {
  const events = await run_tool(async (ctx) => {
    ctx.progress({ label: "", lines: null, output_tail: null, phase: "review" });
    ctx.progress({ label: "", lines: null, output_tail: null });
    ctx.progress({ label: "", lines: 0, output_tail: null });
    ctx.progress({ label: "", lines: 1, output_tail: null });
    return { status: "done", text: "ok", view: null };
  });
  assert.deepEqual(progress_events(events), [
    { label: "", lines: null, output_tail: null, phase: "review" },
    { label: "", lines: null, output_tail: null },
    { label: "", lines: 0, output_tail: null },
  ]);
});

test("an MCP call allowed in auto mode keeps its running label after the review", async () => {
  const events = await run_tool(async (ctx) => {
    assert.equal((await decide(mcp_call(), ctx, mcp_review)).kind, "run");
    ctx.progress({ label: "ce write_memory", lines: null, output_tail: null });
    return { status: "done", text: "ok", view: null };
  }, review_stub([answer("allow")]));
  assert.deepEqual(progress_events(events), [
    { label: "", lines: null, output_tail: null, phase: "review" },
    { label: "", lines: null, output_tail: null },
    { label: "ce write_memory", lines: null, output_tail: null },
  ]);
});

test("a fast allowed review leaves no review phase on the running row", async () => {
  const message: AssistantMessage = { id: "m", role: "assistant", model: "m", effort: "high", mode: "auto", plan: false, created_at: "", ended_at: null, status: "streaming", steps: [], reasoning_details: [], retry: null, error: null, context: null, last_seq: 0 };
  const events = await run_tool(async (ctx) => {
    assert.equal((await gate_command(ctx, "git status --short", "", false)).kind, "run");
    return { status: "done", text: "ok", view: null };
  }, review_stub([answer("allow")]));
  const before_end = events.slice(0, events.findIndex((event) => event.type === "tool_end"));
  const state = apply_events(message, before_end.map((body, index) => ({ ...body, seq: index + 1, at: index })));
  const step = state.steps.find((entry) => entry.kind === "tool");
  assert.deepEqual(progress_events(events).map((entry) => entry.phase ?? "none"), ["review", "none"]);
  assert.deepEqual(step?.kind === "tool" && [step.status, step.progress?.phase], ["running", undefined]);
});
