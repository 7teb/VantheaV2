import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApprovalDecision } from "../shared/approval.ts";
import type { ReviewRecord } from "../shared/review.ts";
import type { Settings } from "../shared/settings.ts";
import { set_claude_runtime } from "../electron/claude/runtime.ts";
import { set_storage_root } from "../electron/storage/paths.ts";
import { gate_command } from "../electron/tools/shell/gate.ts";
import type { Tool } from "../electron/tools/types.ts";
import type { TurnSession } from "../electron/turn/session.ts";
import { run_claude_turn } from "../electron/turn/claude/drive.ts";
import {
  block_stop,
  claude_harness,
  delta,
  ends,
  fake_runtime,
  init,
  make_tool,
  open_steps,
  result,
  settle,
  start,
  stop,
  test_hooks,
  text_response,
  tool_block,
  tool_response,
  until,
  type CallOutcome,
  type ClaudeHarness,
  type FakeQuery,
  type PlannedCall,
} from "./claude-turn-kit.ts";
import type { ReviewStub } from "./review-stub.ts";

set_storage_root("C:\\Users\\user\\AppData\\Roaming\\VantheaX");

const deferred = <T = void>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const begin = (tools: Tool[], over: Partial<TurnSession> = {}) => {
  const fake = fake_runtime();
  set_claude_runtime(fake.runtime);
  const h = claude_harness(tools, over);
  const done = run_claude_turn(h.session, h.input);
  return { fake, h, done };
};

const read_tool = make_tool("read", async ({ args }) => ({ status: "done", text: `read ${String(args.path)}`, view: null }), true);

const run_round = async <T>(calls: PlannedCall[], tools: Tool[], invoke: (query: FakeQuery, h: ClaudeHarness) => Promise<T>, over: Partial<TurnSession> = {}) => {
  const { fake, h, done } = begin(tools, over);
  const query = await fake.opened();
  query.send(init(), ...tool_response("m1", calls));
  const outcome = await invoke(query, h);
  query.send(...text_response("m2", "finished"), result());
  await done;
  assert.equal(ends(h.events).length, 1);
  assert.equal(h.stream_calls(), 0);
  return { h, outcome, query };
};

test("tools/list passes the registry schemas through unchanged with load and size hints", async () => {
  const schema = { type: "object" as const, properties: { path: { type: "string", description: "file" }, depth: { type: "number" } }, required: ["path"], additionalProperties: false };
  const write = make_tool("write", async () => ({ status: "done", text: "", view: null }), false, schema);
  const { fake, h, done } = begin([read_tool, write]);
  const query = await fake.opened();
  const listed = await (await query.client()).listTools();
  const meta = { "anthropic/alwaysLoad": true, "anthropic/maxResultSizeChars": 500000 };
  assert.deepEqual(
    listed.tools.map((tool) => ({ name: tool.name, schema: tool.inputSchema, annotations: tool.annotations, meta: tool._meta, description: tool.description })),
    [
      { name: "read", schema: read_tool.spec.parameters, annotations: { readOnlyHint: true }, meta, description: "read tool" },
      { name: "write", schema, annotations: { readOnlyHint: false }, meta, description: "write tool" },
    ],
  );
  query.send(init(), ...text_response("m1", "ok"), result());
  await done;
  assert.equal(ends(h.events).length, 1);
});

test("a call carrying the tool use id joins that call even when another call has the same name and arguments", async () => {
  const calls = [
    { id: "tu-a", name: "read", input: { path: "same" } },
    { id: "tu-b", name: "read", input: { path: "same" } },
  ];
  const { h, outcome } = await run_round(calls, [read_tool], async (query) => {
    const second = await query.call("read", { path: "same" }, "tu-b");
    const first = await query.call("read", { path: "same" }, "tu-a");
    return [first.text, second.text];
  });
  assert.deepEqual(outcome, ["read same", "read same"]);
  const starts = h.events.flatMap((event) => (event.type === "tool_start" ? [event.call_id] : []));
  assert.deepEqual(starts, ["c0_1", "c0_0"]);
  assert.deepEqual(open_steps(h.events), []);
});

test("without a tool use id the call joins by name and equal arguments, then by name alone", async (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  const calls = [
    { id: "tu-a", name: "read", input: { path: "one" } },
    { id: "tu-b", name: "read", input: { path: "two" } },
  ];
  const { h } = await run_round(calls, [read_tool], async (query) => {
    await query.call("read", { path: "two" });
    await query.call("read", { path: "changed" });
  });
  const ends_by_id = new Map(h.events.flatMap((event) => (event.type === "tool_end" ? [[event.call_id, event.result_text] as const] : [])));
  assert.equal(ends_by_id.get("c0_1"), "read two");
  assert.equal(ends_by_id.get("c0_0"), "read changed");
  assert.equal(warn.mock.calls.filter((call) => String(call.arguments[0]).includes("joined by name")).length, 1);
});

test("a call that arrives before its tool_use was announced waits for the announcement", async () => {
  const { fake, h, done } = begin([read_tool]);
  const query = await fake.opened();
  query.send(init());
  const pending = query.call("read", { path: "late" }, "tu-late");
  await settle();
  assert.equal(h.events.some((event) => event.type === "tool_start"), false);
  query.send(...tool_response("m1", [{ id: "tu-late", name: "read", input: { path: "late" } }]));
  assert.equal((await pending).text, "read late");
  query.send(...text_response("m2", "done"), result());
  await done;
  const order = h.events.filter((event) => event.type === "tool_call" || event.type === "tool_start" || event.type === "tool_end").map((event) => event.type);
  assert.deepEqual(order, ["tool_call", "tool_start", "tool_end"]);
});

test("permit allows only the in-process vantheax server and its input announces the call", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const { fake, h, done } = begin([read_tool]);
  const query = await fake.opened();
  const denied = { behavior: "deny", message: "This tool is not available in this app." };
  assert.deepEqual(await query.permit("Bash", { command: "dir" }, "tu-x", "user", "vantheax"), denied);
  assert.deepEqual(await query.permit("mcp__vantheax__read", { path: "p" }, "tu-y", "sdk", "other"), denied);
  assert.deepEqual(await query.permit("mcp__vantheax__read", { path: "p" }, "tu-1"), { behavior: "allow", updatedInput: { path: "p" } });
  query.send(init(), start("m1"), tool_block(0, "tu-1", "read"), block_stop(0), delta("tool_use"), stop());
  await until(() => h.events.some((event) => event.type === "tool_call"), "tool_call from permit");
  assert.deepEqual(h.events.find((event) => event.type === "tool_call"), { type: "tool_call", round: 0, index: 0, call_id: "c0_0", name: "read", args: { path: "p" } });
  await query.call("read", { path: "p" }, "tu-1");
  query.send(...text_response("m2", "ok"), result());
  await done;
  assert.equal(h.events.filter((event) => event.type === "tool_call").length, 1);
});

test("concurrent tools share the gate and an exclusive tool waits for them and runs alone", async () => {
  const log: string[] = [];
  const release = deferred();
  const slow = (name: string, concurrent: boolean) =>
    make_tool(
      name,
      async ({ args }) => {
        log.push(`start ${String(args.path)}`);
        await release.promise;
        log.push(`end ${String(args.path)}`);
        return { status: "done", text: String(args.path), view: null };
      },
      concurrent,
    );
  const calls = [
    { id: "tu-1", name: "look", input: { path: "a" } },
    { id: "tu-2", name: "look", input: { path: "b" } },
    { id: "tu-3", name: "change", input: { path: "c" } },
  ];
  const { h } = await run_round(calls, [slow("look", true), slow("change", false)], async (query) => {
    const all = Promise.all([query.call("look", { path: "a" }, "tu-1"), query.call("look", { path: "b" }, "tu-2"), query.call("change", { path: "c" }, "tu-3")]);
    await until(() => log.length === 2, "two concurrent starts");
    await settle();
    assert.deepEqual(log, ["start a", "start b"]);
    release.resolve();
    return all;
  });
  assert.deepEqual(log.slice(0, 4).sort(), ["end a", "end b", "start a", "start b"]);
  assert.deepEqual(log.slice(4), ["start c", "end c"]);
  assert.deepEqual(open_steps(h.events), []);
});

test("an approval card in ask mode goes through wait_decision and the decision is recorded", async () => {
  const asked: string[] = [];
  const answer = deferred<ApprovalDecision>();
  const remember = make_tool("remember", async ({ ctx }) => {
    const decision = await ctx.approve({ kind: "memory", action: "remember", text: "likes tests" });
    return decision.approved ? { status: "done", text: "remembered", view: null } : { status: "denied", text: "denied", view: null };
  });
  const wait_decision = (call_id: string) => {
    asked.push(call_id);
    return answer.promise;
  };
  const { h, outcome } = await run_round(
    [{ id: "tu-1", name: "remember", input: {} }],
    [remember],
    async (query, harness) => {
      const call = query.call("remember", {}, "tu-1");
      await until(() => asked.length === 1, "approval wait");
      assert.equal(harness.events.filter((event) => event.type.startsWith("tool_")).at(-1)?.type, "tool_approval");
      answer.resolve({ approved: true, grant: "once", feedback: "" });
      return call;
    },
    { mode: "ask", wait_decision },
  );
  assert.deepEqual(asked, ["c0_0"]);
  const types = h.events.filter((event) => event.type.startsWith("tool_")).map((event) => event.type);
  assert.deepEqual(types, ["tool_draft", "tool_call", "tool_start", "tool_approval", "tool_decision", "tool_start", "tool_end"]);
  assert.equal(outcome.text, "remembered");
});

test("a floor denial from the command gate reaches Claude as an error result and a denied row", async () => {
  const run_command = make_tool("run_command", async ({ args, ctx }) => {
    const verdict = await gate_command(ctx, String(args.command), "C:\\project", false);
    if (verdict.kind !== "run") {
      return { status: "denied", text: verdict.kind === "block" ? verdict.reason : verdict.text, view: null };
    }
    return { status: "done", text: "ran", view: null };
  });
  const command = "Remove-Item -Recurse -Force C:\\Windows\\System32";
  const { h, outcome } = await run_round([{ id: "tu-1", name: "run_command", input: { command } }], [run_command], (query) => query.call("run_command", { command }, "tu-1"), {
    settings: { custom_instructions: "" } as Settings,
  });
  assert.equal(outcome.is_error, true);
  const end = h.events.find((event) => event.type === "tool_end");
  assert.equal(end?.type === "tool_end" && end.status, "denied");
  assert.equal(end?.type === "tool_end" && end.result_text, outcome.text);
  assert.match(outcome.text, /System32|Windows/);
});

test("a review record from the tool emits tool_review and reaches the session mirror", async () => {
  const record = {
    id: "rv-1",
    at: 1,
    actor: { id: "main", name: "main", kind: "main" },
    tool: "run_command",
    subject: "dir",
    cwd: "C:/project",
    verdict: "allow",
    source: "model",
    reason: "fine",
    rule_source: "none",
    rule: "",
    last_human_id: null,
  } as unknown as ReviewRecord;
  const reviewed = make_tool("reviewed", async ({ ctx }) => {
    await ctx.review.record(record);
    return { status: "done", text: "reviewed", view: null };
  });
  const { h } = await run_round([{ id: "tu-1", name: "reviewed", input: {} }], [reviewed], (query) => query.call("reviewed", {}, "tu-1"));
  assert.deepEqual(h.events.find((event) => event.type === "tool_review"), { type: "tool_review", call_id: "c0_0", review: record });
  assert.deepEqual((h.session.review as unknown as ReviewStub).records, [record]);
});

test("stopping while a tool runs answers the call as stopped and ends the turn once", async () => {
  const started = deferred();
  const waiting = make_tool("wait", async ({ ctx }) => {
    started.resolve();
    await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve(), { once: true }));
    throw new Error("aborted by the signal");
  });
  const { fake, h, done } = begin([waiting]);
  const query = await fake.opened();
  query.send(init(), ...tool_response("m1", [{ id: "tu-1", name: "wait", input: {} }]));
  const call = query.call("wait", {}, "tu-1");
  await started.promise;
  h.controller.abort();
  const answered: CallOutcome = await call;
  await done;
  assert.equal(answered.is_error, true);
  assert.equal(answered.text, "The turn was stopped.");
  assert.deepEqual(ends(h.events), [{ type: "end", status: "stopped", error: null }]);
  assert.equal(query.interrupts, 1);
  assert.equal(query.closed, true);
  assert.deepEqual(open_steps(h.events), []);
});

test("images of a tool result go out as image blocks after their label", async () => {
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const shot = make_tool("screenshot", async () => ({ status: "done", text: "captured", view: null, images: [{ bytes: png, mime: "image/png", label: "Screen 1" }] }));
  const stored: number[] = [];
  const store_images: TurnSession["store_images"] = async (images) => {
    stored.push(images.length);
    return Array.from(images.keys(), (at) => `img-${at}`);
  };
  const { h, outcome } = await run_round([{ id: "tu-1", name: "screenshot", input: {} }], [shot], (query) => query.call("screenshot", {}, "tu-1"), { store_images });
  assert.deepEqual(outcome.content, [
    { type: "text", text: "captured" },
    { type: "text", text: "Screen 1" },
    { type: "image", data: png.toString("base64"), mimeType: "image/png" },
  ]);
  assert.deepEqual(stored, [1]);
  const end = h.events.find((event) => event.type === "tool_end");
  assert.deepEqual(end?.type === "tool_end" && end.images, [{ id: "img-0", label: "Screen 1" }]);
  assert.ok(h.api_messages.some((message) => message.role === "user" && message.tool_images));
});

test("a call of a tool that is not in the registry gives the failed unknown tool row", async () => {
  const { h, outcome } = await run_round([{ id: "tu-1", name: "ghost", input: {} }], [read_tool], (query) => query.call("ghost", {}, "tu-1"));
  assert.equal(outcome.is_error, true);
  assert.equal(outcome.text, "Unknown tool: ghost");
  const end = h.events.find((event) => event.type === "tool_end");
  assert.equal(end?.type === "tool_end" && end.status, "failed");
});

test("every call runs through run_call with its hooks under the bare name and the engine call id", async () => {
  const seen: string[] = [];
  const hooks = test_hooks({}, seen);
  const { h } = await run_round([{ id: "tu-1", name: "read", input: { path: "x" } }], [read_tool], (query) => query.call("read", { path: "x" }, "tu-1"), { hooks });
  assert.deepEqual(seen, ["pre read call_turn1_c0_0", "post read"]);
  const tool_message = h.api_messages.find((message) => message.role === "tool");
  assert.deepEqual(tool_message, { role: "tool", tool_call_id: "call_turn1_c0_0", content: "read x" });
});
