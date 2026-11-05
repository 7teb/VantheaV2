import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Message } from "../shared/chat.ts";
import type { TurnEvent } from "../shared/events.ts";
import { create_emitter, type EmitDeps } from "../electron/turn/emit.ts";

const base = (): AssistantMessage => ({
  id: "m1",
  role: "assistant",
  model: "x",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-06T10:00:00.000Z",
  ended_at: null,
  status: "streaming",
  steps: [],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

test("emitter persists before forwarding and flushes on end", () => {
  const order: string[] = [];
  const forwarded: TurnEvent[] = [];
  let message: Message = base();
  const deps: EmitDeps = {
    update_message: (_chat, _id, fn) => {
      order.push("persist");
      message = fn(message);
    },
    forward: (event) => {
      order.push("forward");
      forwarded.push(event);
    },
    flush: () => {
      order.push("flush");
    },
  };
  const emit = create_emitter("c1", "m1", deps);
  emit({ type: "text", round: 0, delta: "hi" });
  emit({ type: "end", status: "done", error: null });

  assert.deepEqual(order, ["persist", "forward", "persist", "forward", "flush"]);
  assert.equal(forwarded[0]?.seq, 1);
  assert.equal(forwarded[1]?.seq, 2);
  assert.equal(forwarded[0]?.chat_id, "c1");
  const assistant = message as AssistantMessage;
  assert.equal(assistant.last_seq, 2);
  assert.equal(assistant.status, "done");
  assert.equal(assistant.steps.filter((step) => step.kind === "text").length, 1);
});

test("stale events never reach forward out of order and seq is monotonic", () => {
  const seqs: number[] = [];
  const deps: EmitDeps = {
    update_message: () => undefined,
    forward: (event) => seqs.push(event.seq),
    flush: () => undefined,
  };
  const emit = create_emitter("c1", "m1", deps);
  emit({ type: "reasoning", round: 0, delta: "a" });
  emit({ type: "text", round: 0, delta: "b" });
  emit({ type: "end", status: "stopped", error: null });
  assert.deepEqual(seqs, [1, 2, 3]);
});

test("nothing is emitted after end, so an interrupted turn ends exactly once", () => {
  const forwarded: TurnEvent[] = [];
  let flushes = 0;
  let message: Message = base();
  const deps: EmitDeps = {
    update_message: (_chat, _id, fn) => {
      message = fn(message);
    },
    forward: (event) => forwarded.push(event),
    flush: () => {
      flushes += 1;
    },
  };
  const emit = create_emitter("c1", "m1", deps);
  emit({ type: "end", status: "interrupted", error: { kind: "app_closed", message: "closed" } });
  emit({ type: "tool_progress", call_id: "c0_0", progress: { label: "x", lines: 1, output_tail: null } });
  emit({ type: "end", status: "stopped", error: null });
  assert.deepEqual(forwarded.map((event) => event.type), ["end"]);
  assert.equal(flushes, 1);
  assert.equal((message as AssistantMessage).status, "interrupted");
});
