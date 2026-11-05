import assert from "node:assert/strict";
import { test } from "node:test";
import type { StreamEventBody, TurnEvent } from "../shared/events.ts";
import { create_smoother, tick_ms, type Delivery, type SmootherClock, type StreamItem } from "../src/api/smoother.ts";

type FakeClock = SmootherClock & { advance: (ms: number) => void; hidden_now: boolean; pending: () => number };

const fake_clock = (): FakeClock => {
  let now = 0;
  let next_id = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock: FakeClock = {
    hidden_now: false,
    now: () => now,
    schedule: (run, delay_ms) => {
      const id = next_id++;
      timers.set(id, { at: now + delay_ms, run });
      return id;
    },
    cancel: (handle) => {
      timers.delete(handle);
    },
    hidden: () => clock.hidden_now,
    pending: () => timers.size,
    advance: (ms) => {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((left, right) => left[1].at - right[1].at)[0];
        if (!due) {
          break;
        }
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = end;
    },
  };
  return clock;
};

const item = (seq: number, body: StreamEventBody, chat_id = "c1"): StreamItem => ({
  kind: "event",
  event: { ...body, seq, at: seq, chat_id, message_id: `m-${chat_id}` } as TurnEvent,
});

const text = (seq: number, delta: string, chat_id = "c1") => item(seq, { type: "text", round: 1, delta }, chat_id);

const setup = () => {
  const clock = fake_clock();
  const batches: Delivery[][] = [];
  const smoother = create_smoother((batch) => batches.push(batch), clock);
  const deliveries = () => batches.flat();
  return { clock, smoother, batches, deliveries };
};

const label = (delivery: Delivery) => {
  if (delivery.kind !== "event") {
    return delivery.kind;
  }
  const event = delivery.event;
  return event.type === "text" || event.type === "reasoning" ? `${event.type}:${event.seq}:${event.delta}` : `${event.type}:${event.seq}`;
};

test("non-text events pass straight through when nothing is queued", () => {
  const { smoother, batches, clock } = setup();
  smoother.push(item(1, { type: "tool_start", call_id: "k" }));
  assert.equal(batches.length, 1);
  assert.equal(label(batches[0][0]), "tool_start:1");
  assert.equal(clock.pending(), 0);
});

test("text is revealed over several ticks and never all at once", () => {
  const { smoother, batches, clock, deliveries } = setup();
  smoother.push(text(1, "x".repeat(400)));
  assert.equal(batches.length, 0);
  clock.advance(tick_ms);
  assert.equal(batches.length, 1);
  const first = deliveries()[0];
  assert.ok(first.kind === "event" && first.event.type === "text" && first.event.delta.length < 400);
  assert.ok(first.kind === "event" && first.partial);
  clock.advance(5000);
  const all = deliveries();
  const joined = all.map((delivery) => (delivery.kind === "event" && delivery.event.type === "text" ? delivery.event.delta : "")).join("");
  assert.equal(joined, "x".repeat(400));
  assert.equal(all.filter((delivery) => delivery.kind === "event" && !delivery.partial).length, 1);
  assert.ok(batches.length > 3);
});

test("events queued behind text keep their order and wait for the text before them", () => {
  const { smoother, clock, deliveries } = setup();
  smoother.push(text(1, "abc".repeat(50)));
  smoother.push(item(2, { type: "tool_call", round: 1, index: 0, call_id: "k", name: "read_file", args: {} }));
  smoother.push(text(3, "after"));
  smoother.push(item(4, { type: "end", status: "done", error: null }));
  clock.advance(tick_ms);
  assert.ok(!deliveries().some((delivery) => label(delivery).startsWith("tool_call")));
  clock.advance(5000);
  const order = deliveries()
    .filter((delivery) => delivery.kind === "event" && !delivery.partial)
    .map((delivery) => (delivery.kind === "event" ? `${delivery.event.type}:${delivery.event.seq}` : ""));
  assert.deepEqual(order, ["text:1", "tool_call:2", "text:3", "end:4"]);
  const seqs = deliveries().map((delivery) => (delivery.kind === "event" ? delivery.event.seq : 0));
  assert.deepEqual(
    seqs,
    [...seqs].sort((left, right) => left - right),
  );
});

test("appended and truncated items keep their place in the chat lane", () => {
  const { smoother, clock, deliveries } = setup();
  smoother.push(text(1, "hello world"));
  smoother.push({ kind: "truncated", chat_id: "c1", message_id: "u1" });
  smoother.push({ kind: "appended", chat_id: "c1", message: { id: "u2", role: "user", text: "", attachments: [], origin: "user", created_at: "" } });
  clock.advance(5000);
  const kinds = deliveries()
    .filter((delivery) => delivery.kind !== "event" || !delivery.partial)
    .map((delivery) => delivery.kind);
  assert.deepEqual(kinds, ["event", "truncated", "appended"]);
});

test("chats stream in independent lanes", () => {
  const { smoother, clock, deliveries } = setup();
  smoother.push(text(1, "y".repeat(300), "slow"));
  smoother.push(item(1, { type: "tool_start", call_id: "k" }, "fast"));
  assert.equal(label(deliveries()[0]), "tool_start:1");
  clock.advance(5000);
  assert.equal(deliveries().filter((delivery) => delivery.kind === "event" && delivery.event.chat_id === "slow" && !delivery.partial).length, 1);
});

test("a hidden window flushes everything immediately", () => {
  const { smoother, clock, deliveries } = setup();
  smoother.push(text(1, "z".repeat(200)));
  clock.hidden_now = true;
  smoother.push(item(2, { type: "end", status: "done", error: null }));
  assert.deepEqual(deliveries().map(label), [`text:1:${"z".repeat(200)}`, "end:2"]);
  assert.equal(clock.pending(), 0);
});

test("splitting never cuts a surrogate pair in half", () => {
  const { smoother, clock, deliveries } = setup();
  smoother.push(text(1, "\u{1F600}".repeat(80)));
  clock.advance(5000);
  for (const delivery of deliveries()) {
    assert.ok(delivery.kind === "event" && delivery.event.type === "text");
    const delta = delivery.event.delta;
    assert.equal(delta.length % 2, 0, `piece of length ${delta.length} splits a pair`);
  }
});

const draft = (seq: number, delta?: string) =>
  item(seq, { type: "tool_draft", round: 1, index: 0, name: "write_file", lines: 1, ...(delta === undefined ? {} : { delta }) });

const draft_delta = (delivery: Delivery) => (delivery.kind === "event" && delivery.event.type === "tool_draft" ? (delivery.event.delta ?? "") : null);

test("tool_draft deltas are paced like text and tool_call waits until the draft is drained", () => {
  const { smoother, batches, clock, deliveries } = setup();
  smoother.push(draft(1));
  assert.equal(batches.length, 1);
  const code = "const x = 1;\n".repeat(60);
  smoother.push(draft(2, code));
  smoother.push(item(3, { type: "tool_call", round: 1, index: 0, call_id: "c1_0", name: "write_file", args: { content: code } }));
  assert.equal(batches.length, 1);
  clock.advance(tick_ms);
  const first = deliveries()[1];
  assert.ok(first.kind === "event" && first.partial);
  assert.ok((draft_delta(first) ?? "").length < code.length);
  assert.ok(!deliveries().some((delivery) => label(delivery).startsWith("tool_call")));
  clock.advance(5000);
  const pieces = deliveries().filter((delivery) => draft_delta(delivery) !== null && delivery.kind === "event" && delivery.event.seq === 2);
  assert.ok(pieces.length > 3);
  assert.equal(pieces.map((delivery) => draft_delta(delivery)).join(""), code);
  assert.deepEqual(
    deliveries()
      .filter((delivery) => delivery.kind === "event" && !delivery.partial)
      .map(label),
    ["tool_draft:1", "tool_draft:2", "tool_call:3"],
  );
});

test("a burst draft with tool_call behind it drains within the close horizon", () => {
  const { smoother, clock, deliveries } = setup();
  smoother.push(draft(1));
  const code = "x".repeat(60000);
  smoother.push(draft(2, code));
  smoother.push(item(3, { type: "tool_call", round: 1, index: 0, call_id: "c1_0", name: "write_file", args: { content: code } }));
  clock.advance(tick_ms);
  assert.ok(!deliveries().some((delivery) => label(delivery).startsWith("tool_call")));
  clock.advance(250 + tick_ms);
  const labels = deliveries().map(label);
  assert.ok(labels.includes("tool_call:3"));
  assert.ok(labels.lastIndexOf("tool_draft:2") < labels.indexOf("tool_call:3"));
  const pieces = deliveries().filter((delivery) => draft_delta(delivery) !== null && delivery.kind === "event" && delivery.event.seq === 2);
  assert.ok(pieces.length > 3);
  assert.equal(pieces.map((delivery) => draft_delta(delivery)).join(""), code);
});

test("dispose drops queued work and cancels the timer", () => {
  const { smoother, clock, deliveries } = setup();
  smoother.push(text(1, "q".repeat(500)));
  smoother.dispose();
  clock.advance(5000);
  assert.equal(deliveries().length, 0);
  assert.equal(clock.pending(), 0);
});
