import assert from "node:assert/strict";
import { test } from "node:test";
import type { StreamEventBody } from "../shared/events.ts";
import { closing_floor, create_status_driver, first_status_ms, refresh_chars, refresh_ms, tail_chars, text_floor, type StatusClock } from "../electron/turn/reasoning-status.ts";
import type { ReasoningStatusCall, StatusRequest, TurnSession } from "../electron/turn/session.ts";

type PendingCall = { input: StatusRequest; signal: AbortSignal; resolve: (text: string) => void; reject: (error: unknown) => void };

const fake_clock = () => {
  let now = 10_000;
  const timers: { at: number; run: () => void; live: boolean }[] = [];
  const clock: StatusClock = {
    now: () => now,
    after: (ms, run) => {
      const timer = { at: now + ms, run, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const timer of timers) {
      if (timer.live && timer.at <= now) {
        timer.live = false;
        timer.run();
      }
    }
  };
  return { clock, advance, pending_timers: () => timers.filter((timer) => timer.live).length };
};

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const harness = (options: { task?: string; call?: ReasoningStatusCall | null } = {}) => {
  const emitted: StreamEventBody[] = [];
  const calls: PendingCall[] = [];
  const controller = new AbortController();
  const call: ReasoningStatusCall = (input, signal) =>
    new Promise<string>((resolve, reject) => {
      calls.push({ input, signal, resolve, reject });
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  const session = {
    chat_id: "chat-1",
    settings: { language: "de" },
    model: { efforts: ["low", "high", "major"] },
    effort: "high",
    delegated_task: options.task,
    signal: controller.signal,
    emit: (body: StreamEventBody) => emitted.push(body),
    reasoning_status: options.call === null ? undefined : (options.call ?? call),
  } as unknown as TurnSession;
  const time = fake_clock();
  const driver = create_status_driver(session, 3, time.clock);
  return { driver, emitted, calls, time, controller };
};

test("no driver exists without a reasoning status call", () => {
  assert.equal(harness({ call: null }).driver, null);
});

test("a reasoning round whose provider hides the reasoning text never asks for a status", () => {
  const { driver, emitted, calls, time } = harness({ task: "Check the agent reports" });
  assert.ok(driver);
  time.advance(first_status_ms * 10);
  driver.reasoning("");
  driver.reasoning("\n\n ");
  time.advance(first_status_ms * 10);
  assert.equal(calls.length, 0);
  assert.equal(time.pending_timers(), 0);
  driver.close();
  assert.deepEqual(emitted, []);
});

test("the first status is asked two seconds after visible reasoning text arrives, with that text", async () => {
  const { driver, emitted, calls, time } = harness({ task: "Check the agent reports" });
  assert.ok(driver);
  time.advance(first_status_ms * 3);
  driver.reasoning("\n");
  assert.equal(time.pending_timers(), 0);
  driver.reasoning("Comparing both agent reports.");
  time.advance(first_status_ms - 1);
  assert.equal(calls.length, 0);
  time.advance(1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.input, { chat_id: "chat-1", language: "de", task: "Check the agent reports", reasoning: "Comparing both agent reports.", previous: "" });
  calls[0]?.resolve("Vergleicht die Berichte beider Agenten.");
  await settle();
  assert.deepEqual(emitted, [{ type: "reasoning_status", round: 3, text: "Vergleicht die Berichte beider Agenten." }]);
});

test("a short block that closes before the first status is due never costs a call", () => {
  const { driver, calls, time } = harness();
  assert.ok(driver);
  driver.reasoning("short");
  time.advance(first_status_ms - 10);
  driver.close();
  time.advance(first_status_ms * 5);
  assert.equal(calls.length, 0);
  assert.equal(time.pending_timers(), 0);
});

test("the status refreshes when the text reaches the floor, on a new heading and after enough time and text", async () => {
  const { driver, calls, time } = harness();
  assert.ok(driver);
  const opening = "Reading the request.";
  driver.reasoning(opening);
  time.advance(first_status_ms);
  assert.equal(calls.length, 1);
  calls[0]?.resolve("Prüft die Anfrage.");
  await settle();
  driver.reasoning("x".repeat(text_floor - opening.length - 1));
  assert.equal(calls.length, 1);
  driver.reasoning("x");
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.input.previous, "Prüft die Anfrage.");
  calls[1]?.resolve("Liest den Speicherpfad.");
  await settle();
  driver.reasoning(" text with an inline **bold");
  assert.equal(calls.length, 2);
  driver.reasoning(" heading** done");
  assert.equal(calls.length, 3);
  calls[2]?.resolve("Ordnet die Überschrift ein.");
  await settle();
  driver.reasoning("y".repeat(tail_chars));
  assert.ok(tail_chars >= refresh_chars);
  assert.equal(calls.length, 3);
  time.advance(refresh_ms);
  driver.reasoning("z");
  assert.equal(calls.length, 4);
  assert.equal(calls[3]?.input.reasoning.length, tail_chars);
  assert.ok(calls[3]?.input.reasoning.endsWith("yz"));
});

test("a newer request cancels the one in flight and only its answer is shown", async () => {
  const { driver, emitted, calls, time } = harness();
  assert.ok(driver);
  driver.reasoning("a");
  time.advance(first_status_ms);
  driver.reasoning("a".repeat(text_floor));
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.signal.aborted, true);
  assert.equal(calls[1]?.signal.aborted, false);
  calls[0]?.resolve("Veraltet.");
  calls[1]?.resolve("Aktuell.");
  await settle();
  assert.deepEqual(
    emitted.map((event) => (event.type === "reasoning_status" ? event.text : event.type)),
    ["Aktuell."],
  );
});

test("a refresh answer that arrives after the block closed or repeats the shown status is dropped", async () => {
  const { driver, emitted, calls, time } = harness();
  assert.ok(driver);
  driver.reasoning("Reading config.json");
  time.advance(first_status_ms);
  calls[0]?.resolve("Liest config.json.");
  await settle();
  driver.reasoning("b".repeat(text_floor));
  calls[1]?.resolve("Liest config.json.");
  await settle();
  assert.equal(emitted.length, 1);
  driver.reasoning(" **Next step**");
  assert.equal(calls.length, 3);
  driver.close();
  assert.equal(calls[2]?.signal.aborted, true);
  calls[2]?.resolve("Zu spät.");
  await settle();
  assert.equal(emitted.length, 1);
});

test("a failed status call is logged and keeps the plain label", async (context) => {
  const warn = context.mock.method(console, "warn", () => undefined);
  const { driver, emitted, calls, time } = harness();
  assert.ok(driver);
  driver.reasoning("Reading the logs");
  time.advance(first_status_ms);
  calls[0]?.reject(new Error("provider unavailable"));
  await settle();
  assert.equal(emitted.length, 0);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0]?.arguments[0]), /chat chat-1 round 3/);
});

test("a dropped attempt cancels its status call and asks again only after the next attempt streams its own reasoning text", () => {
  const { driver, calls, time } = harness();
  assert.ok(driver);
  driver.reasoning("first attempt");
  time.advance(first_status_ms);
  assert.equal(calls.length, 1);
  driver.drop();
  assert.equal(calls[0]?.signal.aborted, true);
  time.advance(first_status_ms * 5);
  assert.equal(calls.length, 1);
  assert.equal(time.pending_timers(), 0);
  driver.reasoning("second attempt");
  time.advance(first_status_ms);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.input.reasoning, "second attempt");
  assert.equal(calls[1]?.input.previous, "");
});

test("stopping the turn aborts the status call", () => {
  const { driver, calls, time, controller } = harness();
  assert.ok(driver);
  driver.reasoning("Reading store.ts");
  time.advance(first_status_ms);
  controller.abort();
  assert.equal(calls[0]?.signal.aborted, true);
});

const long_thought = "Comparing the two save paths before touching the store.";

test("a block that closes before the first status is due sends one closing request with its tail and shows the answer after the close", async () => {
  assert.ok(long_thought.length >= closing_floor);
  const { driver, emitted, calls, time } = harness({ task: "Check the agent reports" });
  assert.ok(driver);
  driver.reasoning(long_thought);
  time.advance(first_status_ms - 10);
  driver.close();
  driver.close();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.input, { chat_id: "chat-1", language: "de", task: "Check the agent reports", reasoning: long_thought, previous: "" });
  assert.equal(time.pending_timers(), 0);
  time.advance(first_status_ms * 5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.signal.aborted, false);
  calls[0]?.resolve("Vergleicht die beiden Speicherwege.");
  await settle();
  assert.deepEqual(emitted, [{ type: "reasoning_status", round: 3, text: "Vergleicht die beiden Speicherwege." }]);
});

test("a first request still in flight when the block closes finishes and its answer is shown, without a second request", async () => {
  const { driver, emitted, calls, time } = harness();
  assert.ok(driver);
  driver.reasoning(long_thought);
  time.advance(first_status_ms);
  assert.equal(calls.length, 1);
  driver.close();
  assert.equal(calls[0]?.signal.aborted, false);
  assert.equal(calls.length, 1);
  calls[0]?.resolve("Vergleicht die beiden Speicherwege.");
  await settle();
  assert.deepEqual(emitted, [{ type: "reasoning_status", round: 3, text: "Vergleicht die beiden Speicherwege." }]);
});

test("no closing request below the text floor, after a stop, or when the last request already saw the whole text", async (context) => {
  const short = harness();
  assert.ok(short.driver);
  short.driver.reasoning(`\n\n${"x".repeat(closing_floor - 1)}  `);
  short.driver.close();
  assert.equal(short.calls.length, 0);
  const enough = harness();
  assert.ok(enough.driver);
  enough.driver.reasoning(`\n${"x".repeat(closing_floor)}`);
  enough.driver.close();
  assert.equal(enough.calls.length, 1);
  const stopped = harness();
  assert.ok(stopped.driver);
  stopped.driver.reasoning(long_thought);
  stopped.controller.abort();
  stopped.driver.close();
  assert.equal(stopped.calls.length, 0);
  const warn = context.mock.method(console, "warn", () => undefined);
  const failed = harness();
  assert.ok(failed.driver);
  failed.driver.reasoning(long_thought);
  failed.time.advance(first_status_ms);
  failed.calls[0]?.reject(new Error("provider unavailable"));
  await settle();
  assert.equal(warn.mock.callCount(), 1);
  failed.driver.close();
  assert.equal(failed.calls.length, 1);
  const grown = harness();
  assert.ok(grown.driver);
  grown.driver.reasoning(long_thought);
  grown.time.advance(first_status_ms);
  grown.calls[0]?.resolve("");
  await settle();
  grown.driver.reasoning(" Then the queue.");
  grown.driver.close();
  assert.equal(grown.calls.length, 2);
  assert.equal(grown.calls[1]?.input.reasoning, `${long_thought} Then the queue.`);
  assert.equal(grown.calls[1]?.input.previous, "");
});

test("a newer block cancels the closing request of the previous one, so an old answer never lands on the newer reasoning", async () => {
  const { driver, emitted, calls } = harness();
  assert.ok(driver);
  driver.reasoning(long_thought);
  driver.close();
  assert.equal(calls.length, 1);
  driver.reasoning("A second block of reasoning.");
  assert.equal(calls[0]?.signal.aborted, true);
  calls[0]?.resolve("Veraltet.");
  await settle();
  assert.deepEqual(emitted, []);
});

test("a retry or a stop cancels the closing request", async () => {
  const retried = harness();
  assert.ok(retried.driver);
  retried.driver.reasoning(long_thought);
  retried.driver.close();
  assert.equal(retried.calls.length, 1);
  retried.driver.drop();
  assert.equal(retried.calls[0]?.signal.aborted, true);
  retried.calls[0]?.resolve("Zu spät.");
  const stopped = harness();
  assert.ok(stopped.driver);
  stopped.driver.reasoning(long_thought);
  stopped.driver.close();
  stopped.controller.abort();
  assert.equal(stopped.calls[0]?.signal.aborted, true);
  await settle();
  assert.deepEqual(retried.emitted, []);
  assert.deepEqual(stopped.emitted, []);
});
