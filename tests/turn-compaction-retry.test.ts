import assert from "node:assert/strict";
import { test } from "node:test";
import type { CompactionStep } from "../shared/chat.ts";
import { compaction_request } from "../electron/context/compact-text.ts";
import { trimmed_stub } from "../electron/context/trim.ts";
import { removed_output_stub } from "../electron/context/window.ts";
import { major_effort } from "../electron/model/catalog.ts";
import { ModelError } from "../electron/model/errors.ts";
import { set_key_source } from "../electron/model/key.ts";
import { round_body, stream_round } from "../electron/model/stream.ts";
import { run_compaction_turn, run_turn_loop } from "../electron/turn/loop.ts";
import type { RoundRequest } from "../electron/model/types.ts";
import type { StreamFn } from "../electron/turn/session.ts";
import { compaction_steps, counted, is_note_call, recording, setup, small, type Recorded } from "./turn-compaction-harness.ts";
import { completed, ends, tool_call, transcript, use_media_root } from "./turn-loop-harness.ts";

use_media_root();

set_key_source(() => "sk-or-test-key");

const schedule = [2000, 5000, 10_000, ...Array.from({ length: 10 }, () => 60_000)];

const first_round = (request: RoundRequest, call: number) =>
  call === 1 ? completed({ tool_calls: [tool_call("read_file")], finish_reason: "tool_calls", usage: counted(request, 1) }) : completed({ content: "fixed" });

const over_window = "z".repeat(28_400);

test("a failing compaction retries after 2, 5 and 10 s, then every 60 s at most ten times, shows the reason and the next try, then drops old tool results", async () => {
  const { calls, stream } = recording((request, call) => {
    if (is_note_call(request)) {
      throw new ModelError("provider_unavailable", "OpenRouter 503: down", 503);
    }
    return first_round(request, call);
  });
  const { h, saved, sleeps } = setup(stream, "z".repeat(32_000));
  await run_turn_loop(h.session, h.messages);
  const note_calls = calls.filter((call) => is_note_call(call.request));
  assert.equal(note_calls.length, 14);
  assert.deepEqual(sleeps, schedule);
  assert.equal(saved.length, 0);
  const waiting = h.events.filter((event) => event.type === "compaction" && event.status === "waiting");
  assert.deepEqual(waiting.map((event) => event.type === "compaction" && event.wait_ms), schedule);
  assert.deepEqual(waiting.map((event) => event.type === "compaction" && event.attempt), schedule.map((_wait, index) => index + 1));
  assert.ok(waiting.every((event) => event.type === "compaction" && event.error?.kind === "provider_unavailable"));
  const first_wait = h.events.findIndex((event) => event.type === "compaction" && event.status === "waiting");
  const shown = transcript(h.events.slice(0, first_wait + 1)).steps.find((step): step is CompactionStep => step.kind === "compaction");
  assert.equal(shown?.status, "waiting");
  assert.equal(shown?.attempt, 1);
  assert.equal(shown?.attempts, 14);
  assert.equal(shown?.error?.message, "OpenRouter 503: down");
  assert.equal(shown?.retry_at, first_wait + 1 + 2000);
  const [line] = compaction_steps(h);
  assert.equal(line?.status, "failed");
  assert.equal(line?.error?.kind, "provider_unavailable");
  assert.ok((calls.at(-1) as Recorded).messages.some((message) => message.role === "tool" && message.content === trimmed_stub));
  assert.ok(h.events.some((event) => event.type === "notice" && event.notice === "context_trimmed"));
  assert.equal(ends(h.events)[0]?.type === "end" && ends(h.events)[0]?.status, "done");
});

test("an empty note is a failed attempt that the next try after 2 s can fix", async () => {
  let notes = 0;
  const { stream } = recording((request, call) => {
    if (is_note_call(request)) {
      notes += 1;
      return completed({ content: notes === 1 ? "  " : "TASK: t" });
    }
    return first_round(request, call);
  });
  const { h, saved, sleeps } = setup(stream, over_window);
  await run_turn_loop(h.session, h.messages);
  assert.deepEqual(sleeps, [2000]);
  assert.equal(saved.length, 1);
  assert.deepEqual(compaction_steps(h).map((step) => step.status), ["done"]);
  const attempts = h.events.flatMap((event) => (event.type === "compaction" && event.status === "running" ? [event.attempt] : []));
  assert.deepEqual(attempts, [1, 2]);
});

test("an error that is not a ModelError is caught, classified as internal and retried", async () => {
  let notes = 0;
  const { stream } = recording((request, call) => {
    if (is_note_call(request)) {
      notes += 1;
      if (notes <= 4) {
        throw new TypeError("socket hang up");
      }
      return completed({ content: "TASK: t" });
    }
    return first_round(request, call);
  });
  const { h, sleeps } = setup(stream, over_window);
  await run_turn_loop(h.session, h.messages);
  assert.deepEqual(sleeps, [2000, 5000, 10_000, 60_000]);
  const waiting = h.events.filter((event) => event.type === "compaction" && event.status === "waiting");
  assert.deepEqual(
    waiting.map((event) => event.type === "compaction" && event.error),
    Array.from({ length: 4 }, () => ({ kind: "internal", message: "socket hang up" })),
  );
  assert.deepEqual(compaction_steps(h).map((step) => step.status), ["done"]);
});

test("a context-length error removes the oldest tool outputs one per rejection, skips the waits and then goes straight to the fallback", async () => {
  const { calls, stream } = recording((request, call) => {
    if (is_note_call(request)) {
      throw new ModelError("context_limit", "too long", 400);
    }
    return first_round(request, call);
  });
  const { h, sleeps } = setup(stream, "z".repeat(28_000));
  await run_turn_loop(h.session, h.messages);
  const notes = calls.filter((call) => is_note_call(call.request));
  assert.equal(notes.length, 2);
  assert.ok(notes[0]?.messages.some((message) => message.role === "tool" && message.content === "z".repeat(28_000)));
  assert.ok(notes[1]?.messages.some((message) => message.role === "tool" && message.content === removed_output_stub));
  assert.equal(notes[1]?.messages.at(-1)?.content, compaction_request("user", [{ tool: "read_file", call_id: "call_m_c0_0" }]));
  assert.deepEqual(sleeps, []);
  assert.deepEqual(compaction_steps(h).map((step) => `${step.status}:${step.error?.kind}`), ["failed:context_limit"]);
  assert.ok((calls.at(-1) as Recorded).messages.some((message) => message.role === "tool" && message.content === trimmed_stub));
  assert.equal(ends(h.events)[0]?.type === "end" && ends(h.events)[0]?.status, "done");
});

test("a stop during the wait between attempts ends the turn at once", async () => {
  const { calls, stream } = recording((request, call) => {
    if (is_note_call(request)) {
      throw new ModelError("rate_limited", "OpenRouter 429: slow down", 429);
    }
    return first_round(request, call);
  });
  const { h, sleeps } = setup(stream, "z".repeat(32_000));
  h.session.compaction.sleep = async (ms) => {
    sleeps.push(ms);
    h.controller.abort(new Error("stop"));
  };
  await run_turn_loop(h.session, h.messages);
  assert.deepEqual(sleeps, [2000]);
  assert.equal(calls.filter((call) => is_note_call(call.request)).length, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(compaction_steps(h).map((step) => step.status), ["interrupted"]);
  assert.equal(ends(h.events)[0]?.type === "end" && ends(h.events)[0]?.status, "stopped");
});

test("a manual compaction that fails for good ends the turn failed with the reason after one attempt", async () => {
  const { calls, stream } = recording(() => {
    throw new ModelError("auth", "OpenRouter 401: bad key", 401);
  });
  const { h, sleeps } = setup(stream, "ok");
  await run_compaction_turn(h.session, h.messages);
  assert.equal(calls.length, 1);
  assert.deepEqual(sleeps, []);
  assert.ok(!h.events.some((event) => event.type === "compaction" && event.status === "waiting"));
  const [end] = ends(h.events);
  assert.equal(end?.type === "end" && end.status, "failed");
  assert.deepEqual(end?.type === "end" && end.error, { kind: "auth", message: "OpenRouter 401: bad key" });
  assert.deepEqual(compaction_steps(h).map((step) => `${step.status}:${step.error?.kind}`), ["failed:auth"]);
});

const http_failure = (status: number, message: string, posts: { count: number }): StreamFn => (request, callbacks, signal, overrides = {}) =>
  stream_round(request, callbacks, signal, {
    ...overrides,
    fetch: async () => {
      posts.count += 1;
      return new Response(JSON.stringify({ error: { code: status, message } }), { status });
    },
    sleep: async () => undefined,
    random: () => 0,
  });

const manual_over_http = async (status: number, message: string) => {
  const posts = { count: 0 };
  const { h, sleeps } = setup(http_failure(status, message, posts), "ok");
  await run_compaction_turn(h.session, h.messages);
  const [end] = ends(h.events);
  return { posts: posts.count, sleeps, end: end?.type === "end" ? `${end.status}:${end.error?.kind}` : "" };
};

test("no credits and a bad request end a manual compaction after one request without waiting", async () => {
  assert.deepEqual(await manual_over_http(402, "Insufficient credits"), { posts: 1, sleeps: [], end: "failed:credits" });
  assert.deepEqual(await manual_over_http(400, "Invalid value for tool_choice"), { posts: 1, sleeps: [], end: "failed:bad_request" });
});

test("a provider outage keeps the full compaction schedule", async () => {
  assert.deepEqual(await manual_over_http(503, "No instances available"), { posts: 14, sleeps: schedule, end: "failed:provider_unavailable" });
});

test("the note is written with the effort of the rounds, so its request repeats their prefix", async () => {
  const graded = { ...small, efforts: ["low", "medium", "high", "xhigh", major_effort], default_effort: "medium" };
  const efforts = async (selected: string) => {
    const { calls, stream } = recording((request, call) => {
      if (is_note_call(request)) {
        return completed({ content: "TASK: t" });
      }
      return first_round(request, call);
    });
    const { h } = setup(stream, over_window);
    h.session.model = graded;
    h.session.effort = selected;
    await run_turn_loop(h.session, h.messages);
    return calls.map((call) => `${is_note_call(call.request) ? "note" : "round"}:${call.request.effort}`);
  };
  assert.deepEqual(await efforts("low"), ["round:low", "note:low", "round:low"]);
  assert.deepEqual(await efforts("xhigh"), ["round:xhigh", "note:xhigh", "round:xhigh"]);
  assert.deepEqual(await efforts(major_effort), [`round:${major_effort}`, `note:${major_effort}`, `round:${major_effort}`]);
});

test("a model with one effort writes the note with it, a model without efforts sends no reasoning field", async () => {
  const note_request = async (efforts: string[], effort: string) => {
    const { calls, stream } = recording((request, call) => {
      if (is_note_call(request)) {
        return completed({ content: "TASK: t" });
      }
      return first_round(request, call);
    });
    const { h } = setup(stream, over_window);
    h.session.model = { ...small, efforts, default_effort: efforts[0] ?? "" };
    h.session.effort = effort;
    await run_turn_loop(h.session, h.messages);
    return (calls.find((call) => is_note_call(call.request)) as Recorded).request;
  };
  assert.equal((await note_request(["medium", major_effort], "medium")).effort, "medium");
  const bare = await note_request([], "");
  assert.equal(bare.effort, "");
  assert.equal("reasoning" in round_body(bare), false);
});

test("with the real wait a stop during the 2 s pause ends the turn without waiting it out", async () => {
  const { stream } = recording((request, call) => {
    if (is_note_call(request)) {
      setTimeout(() => h.controller.abort(new Error("stop")), 20);
      throw new ModelError("provider_unavailable", "OpenRouter 502: bad gateway", 502);
    }
    return first_round(request, call);
  });
  const { h } = setup(stream, "z".repeat(32_000));
  delete h.session.compaction.sleep;
  const started = Date.now();
  await run_turn_loop(h.session, h.messages);
  assert.ok(Date.now() - started < 1500);
  assert.equal(ends(h.events)[0]?.type === "end" && ends(h.events)[0]?.status, "stopped");
});
