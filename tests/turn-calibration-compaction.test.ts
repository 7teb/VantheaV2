import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Message } from "../shared/chat.ts";
import type { StreamEventBody } from "../shared/events.ts";
import { measure_request, sent_estimate, stored_context } from "../electron/context/calibration.ts";
import { compaction_request } from "../electron/context/compact-text.ts";
import { image_left_out_text } from "../electron/context/images.ts";
import { trimmed_stub } from "../electron/context/trim.ts";
import { removed_output_stub } from "../electron/context/window.ts";
import { ModelError } from "../electron/model/errors.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import { counted, is_note_call, type Recorded } from "./turn-compaction-harness.ts";
import { ask, contexts, measured, new_chat, provider, reload_from_disk, run_chat_turn, scale_of, window_model, working_calls } from "./turn-calibration-harness.ts";
import { completed, harness, queue_steers, tool_call, use_media_root } from "./turn-loop-harness.ts";

use_media_root();

const x = window_model("x");

const reads = (count: number) => (_request: unknown, working: number) =>
  working <= count ? { tool_calls: [tool_call("read_file")], finish_reason: "tool_calls" } : { content: "fertig" };

const compaction_states = (events: StreamEventBody[]) => events.flatMap((event) => (event.type === "compaction" ? [`${event.round}:${event.status}`] : []));

const context_before = (events: StreamEventBody[], type: StreamEventBody["type"], status?: string) => {
  const at = events.findIndex((event) => event.type === type && (status === undefined || ("status" in event && event.status === status)));
  return contexts(events.slice(0, at)).at(-1);
};

test("tool outputs that cross 70 percent show in the ring before the compaction starts, measured as the provider count plus the scaled outputs", async () => {
  const chat = new_chat();
  ask(chat, "lies beide Dateien");
  const { calls, stream } = provider(1.2, reads(2));
  const { events } = await run_chat_turn(chat, x, stream, { tool_text: "t".repeat(12_000) });
  const [, , , after_reads, shown] = contexts(events);
  assert.ok(after_reads && shown);
  assert.equal(after_reads.used, shown.used);
  assert.ok(shown.used > x.context_length * 0.7);
  assert.deepEqual(contexts(events.slice(0, events.findIndex((event) => event.type === "compaction"))).at(-1), shown);
  const second = working_calls(calls)[1] as Recorded;
  const sent: ApiMessage[] = [
    ...second.messages,
    { role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "read_file", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "x", content: "t".repeat(12_000) },
  ];
  assert.ok(sent_estimate(sent, second.request.tools, x) < x.context_length * 0.7);
  assert.equal(shown.used, Math.ceil(sent_estimate(sent, second.request.tools, x) * scale_of(shown)));
  assert.deepEqual(compaction_states(events), ["2:running", "2:done"]);
});

test("every check measures exactly the request that goes out, steers, agent notes and continuation text included", async () => {
  const h = harness(async () => completed({}), []);
  const steers = queue_steers(h);
  let note_pending = false;
  h.session.take_notes = () => {
    if (!note_pending) {
      return [];
    }
    note_pending = false;
    return [{ kind: "notice", notice: "agent_report", text: "", content: "report ".repeat(300) }];
  };
  const seen: { call: Recorded; check: number }[] = [];
  let working = 0;
  h.session.stream = async (request, callbacks) => {
    seen.push({ call: { request, messages: request.messages.map((message) => ({ ...message })) }, check: contexts(h.events).at(-1)?.used ?? -1 });
    working += 1;
    if (working === 1) {
      steers.push("nimm den zweiten Ansatz ".repeat(40));
      return completed({ content: "teil eins", finish_reason: "length", usage: counted(request, 1.25) });
    }
    if (working === 2) {
      note_pending = true;
      callbacks.on_text("teil zwei");
      return completed({ content: "teil zwei", finish_reason: "length", usage: null });
    }
    return completed({ content: "fertig", usage: { prompt_tokens: 0, completion_tokens: 5, reasoning_tokens: 0 } });
  };
  h.messages.push({ role: "user", instruction: true, content: "erkläre es" });
  await run_turn_loop(h.session, h.messages);
  assert.equal(seen.length, 3);
  const first = seen[0] as { call: Recorded; check: number };
  const ratio = Math.round(sent_estimate(first.call.messages, first.call.request.tools, h.session.model) * 1.25) / sent_estimate(first.call.messages, first.call.request.tools, h.session.model);
  for (const { call, check } of seen.slice(1)) {
    assert.equal(check, measured(call, ratio));
  }
  const last = seen[2] as { call: Recorded; check: number };
  assert.ok(last.call.messages.some((message) => JSON.stringify(message.content).includes("nimm den zweiten Ansatz")));
  assert.ok(last.call.messages.some((message) => JSON.stringify(message.content).includes("report report")));
  assert.ok(contexts(h.events).every((usage, index) => index < 2 || Math.abs(scale_of(usage) - ratio) < 1e-9));
});

test("a compaction that stays above 70 percent sets the floor, the next turn of the same model keeps it and another model starts at 0", async () => {
  const chat = new_chat();
  ask(chat, `fix the bug ${"r".repeat(27_000)}`);
  const first = provider(1.12, reads(1));
  const turn = await run_chat_turn(chat, x, first.stream);
  assert.deepEqual(compaction_states(turn.events), ["1:running", "1:done"]);
  const check = context_before(turn.events, "compaction", "running");
  const after = contexts(turn.events).at(-1);
  assert.ok(check && after && after.floor !== undefined);
  assert.ok(after.floor > x.context_length * 0.7);
  const compacted = contexts(turn.events.slice(turn.events.findIndex((event) => event.type === "compaction" && event.status === "done")))[0];
  assert.deepEqual(compacted?.calibration, check.calibration);
  assert.ok(compacted?.floor !== undefined);
  assert.equal(after.floor, Math.ceil((compacted.floor * scale_of(after)) / scale_of(compacted)));
  assert.equal(turn.message.context?.floor, after.floor);
  ask(chat, "und jetzt?");
  const same = provider(1.12, () => ({ content: "weiter" }));
  const next = await run_chat_turn(chat, x, same.stream);
  assert.equal(contexts(next.events)[0]?.floor, after.floor);
  assert.ok((contexts(next.events)[0]?.used ?? 0) > x.context_length * 0.7);
  assert.equal(same.calls.some((call) => is_note_call(call.request)), false);
  ask(chat, "anderes Modell");
  const other = provider(1, () => ({ content: "ok" }));
  const switched = await run_chat_turn(chat, window_model("y", 20_000), other.stream);
  assert.equal(contexts(switched.events)[0]?.floor, 0);
  assert.equal(contexts(switched.events)[0]?.calibration, undefined);
});

test("a floor set with the estimate is rescaled when the first round calibrates, so a round without growth does not compact again", async () => {
  const chat = new_chat();
  ask(chat, `fix the bug ${"r".repeat(28_800)}`);
  const { calls, stream } = provider(1.2, reads(1));
  const { events } = await run_chat_turn(chat, x, stream, { tool_text: "t".repeat(5) });
  assert.deepEqual(compaction_states(events), ["0:running", "0:done"]);
  assert.equal(calls.filter((call) => is_note_call(call.request)).length, 1);
  const set = contexts(events.slice(events.findIndex((event) => event.type === "compaction" && event.status === "done")))[0];
  assert.ok(set && set.calibration === undefined && set.floor !== undefined && set.floor > x.context_length * 0.7);
  const calibrated = contexts(events).find((usage) => usage.calibration);
  assert.ok(calibrated);
  assert.equal(calibrated.floor, Math.ceil(set.floor * scale_of(calibrated)));
  const last = contexts(events).at(-1);
  assert.ok(last && last.used > x.context_length * 0.7 && last.used < (last.floor ?? 0) + x.context_length * 0.1);
});

test("a compaction that fails for good trims with the scaled measure, blocks a retry in the same turn and stores no floor for the next turn", async () => {
  const chat = new_chat();
  ask(chat, "lies alles");
  const stream = provider(1.2, reads(3)).stream;
  const failing: typeof stream = async (request, callbacks, signal) => {
    if (is_note_call(request)) {
      throw new ModelError("rate_limited", "429 temporarily rate-limited upstream", 429);
    }
    return stream(request, callbacks, signal);
  };
  const { events, api } = await run_chat_turn(chat, x, failing, { tool_text: "t".repeat(12_000) });
  const check = context_before(events, "compaction", "running");
  assert.ok(check && check.used > x.context_length * 0.7);
  assert.equal(new Set(compaction_states(events)).size, 3);
  assert.deepEqual(compaction_states(events).slice(-1), ["2:failed"]);
  const settled = contexts(events.slice(events.findIndex((event) => event.type === "compaction" && event.status === "failed")))[0];
  assert.equal(settled?.floor, 0);
  assert.ok(settled && settled.used <= x.context_length * 0.7);
  assert.equal(api.filter((message) => message.role === "tool" && message.content === trimmed_stub).length, 1);
  const later = contexts(events).at(-1);
  assert.ok(later && later.used > x.context_length * 0.7 && later.used < check.used + x.context_length * 0.1);
  assert.equal(later?.floor, 0);
});

test("a stopped compaction ends the turn stopped and keeps the context of the check that started it", async () => {
  const chat = new_chat();
  ask(chat, `fix the bug ${"r".repeat(27_000)}`);
  const first = provider(1.12, reads(1));
  let stop = () => undefined as void;
  const stream: typeof first.stream = async (request, callbacks, signal) => {
    if (is_note_call(request)) {
      stop();
      return completed({ status: "cancelled" });
    }
    return first.stream(request, callbacks, signal);
  };
  const { message, events } = await run_chat_turn(chat, x, stream, {
    prepare: (h) => {
      stop = () => h.controller.abort(new Error("stop"));
    },
  });
  assert.equal(message.status, "stopped");
  assert.deepEqual(message.context, context_before(events, "compaction", "running"));
  assert.ok((message.context?.used ?? 0) > x.context_length * 0.7);
});

const tool_turn = (id: string, outputs: string[], calibration: { prompt_tokens: number; estimate: number }): AssistantMessage => ({
  id,
  role: "assistant",
  model: "x",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-12T10:00:01.000Z",
  ended_at: "2026-10-12T10:00:05.000Z",
  status: "done",
  steps: outputs.map((output, index) => ({
    id: `${id}-t${index}`,
    round: index,
    kind: "tool",
    index: 0,
    call_id: `c${index}_0`,
    name: "read_file",
    args: {},
    status: "done",
    progress: null,
    approval: null,
    view: null,
    error: null,
    result_text: output,
    started_at: 1,
    ended_at: 2,
  })),
  reasoning_details: [],
  retry: null,
  error: null,
  context: { used: 1, limit: 12_000, calibration, floor: 0 },
  last_seq: 9,
});

test("a manual compaction fits its note request with the stored calibration and reports the scaled measure and floor, the next turn reuses that calibration", async () => {
  const wide = window_model("x", 12_000);
  const user: Message = { id: "u1", role: "user", text: "lies", attachments: [], origin: "user", created_at: "2026-10-12T10:00:00.000Z" };
  const calibration = { prompt_tokens: 1300, estimate: 1000 };
  const chat = { messages: [user, tool_turn("a1", ["o".repeat(18_000), "p".repeat(18_000)], calibration)] as Message[], summary: null };
  const { calls, stream } = provider(1, () => ({ content: "TASK: t" }));
  const { message, events, api, session } = await run_chat_turn(chat, wide, stream, { compact_only: true });
  const note = calls[0] as Recorded;
  assert.equal(note.messages.filter((message) => message.content === removed_output_stub).length, 1);
  assert.equal(note.messages.at(-1)?.content, compaction_request("user", [{ tool: "read_file", call_id: "call_a1_c0_0" }]));
  const [reported] = contexts(events);
  const specs = session.resolve_tools("main").map((tool) => tool.spec);
  assert.equal(reported?.used, measure_request(api, specs, wide, calibration));
  assert.deepEqual(reported?.calibration, calibration);
  assert.equal(reported?.floor, 0);
  assert.deepEqual(message.context, reported);
  assert.deepEqual(stored_context(chat.messages, "x").calibration, calibration);
});

test("a manual compaction without a calibration measures with the estimate", async () => {
  const chat = new_chat();
  ask(chat, "hallo");
  const { stream } = provider(1, () => ({ content: "TASK: t" }));
  const { events, api, session } = await run_chat_turn(chat, x, stream, { compact_only: true });
  const [reported] = contexts(events);
  assert.equal(reported?.calibration, undefined);
  assert.equal(reported?.used, sent_estimate(api, session.resolve_tools("main").map((tool) => tool.spec), x));
});

test("an app killed after the summary was saved but before the post-compaction measure does not compact again on the next turn", async () => {
  const chat = new_chat();
  ask(chat, "lies beide Dateien");
  const first = provider(1.2, reads(2));
  await run_chat_turn(chat, x, first.stream, {
    tool_text: "t".repeat(12_000),
    keep: (events) => events.slice(0, events.findIndex((event) => event.type === "compaction" && event.status === "done") + 1),
  });
  assert.ok(chat.summary);
  const loaded = reload_from_disk(chat);
  const stale = loaded.messages.at(-1);
  assert.ok(stale?.role === "assistant" && (stale.context?.used ?? 0) > x.context_length * 0.7);
  ask(loaded, "Continue", "continue");
  const next = provider(1.2, () => ({ content: "weiter" }));
  const { events } = await run_chat_turn(loaded, x, next.stream);
  assert.equal(next.calls.some((call) => is_note_call(call.request)), false);
  assert.ok((contexts(events)[0]?.used ?? 0) < x.context_length * 0.7);
});

const png_url = (width: number, height: number) => {
  const head = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write("IHDR", 12, "ascii");
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return `data:image/png;base64,${head.toString("base64")}`;
};

test("the calibration estimate is taken after oversized images were left out of the request", async () => {
  let sent = 0;
  const h = harness(async (request) => {
    sent = sent_estimate(request.messages, request.tools, request.model);
    return completed({ content: "ok", usage: counted(request, 1.1) });
  }, []);
  h.session.model = { ...window_model("anthropic/claude-x", 100_000), provider_order: ["anthropic"], vision: true };
  h.messages.push({ role: "user", instruction: true, content: [{ type: "text", text: "see" }, { type: "image_url", image_url: { url: png_url(9000, 100) } }] });
  await run_turn_loop(h.session, h.messages);
  assert.ok(JSON.stringify(h.messages).includes(image_left_out_text));
  assert.equal(contexts(h.events).at(-1)?.calibration?.estimate, sent);
});
