import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { Message, ReasoningStep } from "../shared/chat.ts";
import type { StreamEventBody, TurnEvent } from "../shared/events.ts";
import type { RoundCallbacks } from "../electron/model/types.ts";
import { create_emitter } from "../electron/turn/emit.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import { first_status_ms } from "../electron/turn/reasoning-status.ts";
import { run_round } from "../electron/turn/round.ts";
import type { StatusRequest, StreamFn } from "../electron/turn/session.ts";
import { build_blocks, shows_thinking } from "../src/features/chat/assistant-blocks.ts";
import { completed, harness, transcript } from "./turn-loop-harness.ts";

type Probe = { callbacks: RoundCallbacks; tick: (ms: number) => Promise<void>; seen: () => StreamEventBody[]; asked: () => number };

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const round_with = async (context: TestContext, script: (probe: Probe) => Promise<void>) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const requests: StatusRequest[] = [];
  const tick = async (ms: number) => {
    context.mock.timers.tick(ms);
    await settle();
  };
  const stream: StreamFn = async (_request, callbacks) => {
    await script({ callbacks, tick, seen: () => [...h.events], asked: () => requests.length });
    callbacks.on_text("Answer");
    return completed({ content: "Answer" });
  };
  const h = harness(stream, []);
  h.session.reasoning_status = async (input) => {
    requests.push(input);
    return "Liest den Store.";
  };
  await run_round(h.session, 0, [...h.messages, { role: "user", content: "go" }], null, 0);
  await settle();
  return { requests, events: h.events };
};

const reasoning_steps = (events: StreamEventBody[]) => transcript(events).steps.filter((step): step is ReasoningStep => step.kind === "reasoning");

test("a round whose route hides the reasoning sends no status call and keeps the plain Thinking row", async (context) => {
  const { requests, events } = await round_with(context, async ({ callbacks, tick, seen, asked }) => {
    await tick(first_status_ms * 5);
    const hidden = transcript(seen());
    assert.deepEqual(reasoning_steps(seen()), []);
    assert.equal(shows_thinking(hidden.status === "streaming", false, build_blocks(hidden.steps)), true);
    callbacks.on_reasoning("\n");
    await tick(first_status_ms * 5);
    assert.equal(asked(), 0);
    assert.deepEqual(
      reasoning_steps(seen()).map((step) => [step.text, step.status_line]),
      [["\n", undefined]],
    );
    callbacks.on_retry(1, 9, "provider unavailable", 1000);
    await tick(first_status_ms * 5);
    assert.deepEqual(reasoning_steps(seen()), []);
  });
  assert.equal(requests.length, 0);
  assert.equal(events.some((event) => event.type === "reasoning_status"), false);
  assert.deepEqual(reasoning_steps(events), []);
});

test("a round that streams reasoning text asks for a status two seconds in and keeps it on the finished step", async (context) => {
  const { requests, events } = await round_with(context, async ({ callbacks, tick, seen, asked }) => {
    await tick(first_status_ms * 3);
    assert.equal(asked(), 0);
    callbacks.on_reasoning("Reading store.ts and the save queue.");
    await tick(first_status_ms - 1);
    assert.equal(asked(), 0);
    await tick(1);
    assert.equal(asked(), 1);
    const [step] = reasoning_steps(seen());
    assert.equal(step?.status_line, "Liest den Store.");
    assert.equal(step?.text, "Reading store.ts and the save queue.");
  });
  assert.deepEqual(requests, [{ chat_id: "c", language: undefined, task: "", reasoning: "Reading store.ts and the save queue.", previous: "" }]);
  assert.deepEqual(
    events.map((event) => event.type),
    ["reasoning", "reasoning_status", "text"],
  );
  const [finished] = reasoning_steps(events);
  assert.ok(finished);
  assert.notEqual(finished.ended_at, null);
  assert.equal(finished.status_line, "Liest den Store.");
});

test("a thought that ends before the first status is due gets its status after it closed, on its own step, without holding the round", async (context) => {
  const thought = "Comparing the two save paths before touching the store.";
  const { requests, events } = await round_with(context, async ({ callbacks, tick, asked }) => {
    callbacks.on_reasoning(thought);
    await tick(first_status_ms - 10);
    assert.equal(asked(), 0);
  });
  assert.deepEqual(requests, [{ chat_id: "c", language: undefined, task: "", reasoning: thought, previous: "" }]);
  assert.deepEqual(
    events.map((event) => event.type),
    ["reasoning", "text", "reasoning_status"],
  );
  const steps = transcript(events).steps;
  assert.deepEqual(
    steps.map((step) => [step.kind, step.kind === "reasoning" ? step.status_line : null]),
    [
      ["reasoning", "Liest den Store."],
      ["text", null],
    ],
  );
  assert.equal(steps[0]?.kind === "reasoning" && steps[0].ended_at, 2);
});

test("a late status that arrives after the turn ended is never emitted and leaves the stored message alone", async () => {
  let answer: (text: string) => void = () => undefined;
  let asked = 0;
  const stream: StreamFn = async (_request, callbacks) => {
    callbacks.on_reasoning("Comparing the two save paths before touching the store.");
    callbacks.on_text("Answer");
    return completed({ content: "Answer" });
  };
  const h = harness(stream, []);
  h.session.reasoning_status = () => {
    asked += 1;
    return new Promise<string>((resolve) => {
      answer = resolve;
    });
  };
  const forwarded: TurnEvent[] = [];
  let stored: Message = transcript([]);
  h.session.emit = create_emitter("c", "m", {
    update_message: (_chat, _id, fn) => {
      stored = fn(stored);
    },
    forward: (event) => forwarded.push(event),
    flush: () => undefined,
  });
  await run_turn_loop(h.session, h.messages);
  assert.equal(asked, 1);
  assert.equal(forwarded.at(-1)?.type, "end");
  answer("Vergleicht die beiden Speicherwege.");
  await settle();
  assert.equal(forwarded.at(-1)?.type, "end");
  assert.equal(forwarded.some((event) => event.type === "reasoning_status"), false);
  assert.equal(stored.role === "assistant" && stored.steps.some((step) => step.kind === "reasoning" && step.status_line !== undefined), false);
});
