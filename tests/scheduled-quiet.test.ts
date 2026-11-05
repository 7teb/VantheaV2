import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Message } from "../shared/chat.ts";
import type { TurnEvent } from "../shared/events.ts";
import { no_new_activity } from "../shared/scheduled.ts";
import { create_emitter, type EmitDeps, type QuietEnd } from "../electron/turn/emit.ts";
import { mark_event, row_status } from "../src/state/chat-marks-rules.ts";
import { chime_for } from "../src/state/chime-rules.ts";

const base = (): AssistantMessage => ({
  id: "m1",
  role: "assistant",
  model: "x",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-11-04T10:00:00.000Z",
  ended_at: null,
  status: "streaming",
  steps: [],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

const harness = (quiet_end?: QuietEnd) => {
  let message: Message = base();
  const forwarded: TurnEvent[] = [];
  const deps: EmitDeps = {
    update_message: (_chat, _id, fn) => {
      message = fn(message);
    },
    forward: (event) => forwarded.push(event),
    flush: () => undefined,
  };
  return { emit: create_emitter("c1", "m1", deps, quiet_end), forwarded, message: () => message as AssistantMessage };
};

test("quiet_end puts quiet on the stored and the forwarded end event and only there", () => {
  const seen: string[] = [];
  const kit = harness((message, end) => {
    seen.push(`${end.status}:${message.steps.length}`);
    return true;
  });
  kit.emit({ type: "text", round: 0, delta: no_new_activity });
  kit.emit({ type: "end", status: "done", error: null });
  assert.deepEqual(seen, ["done:1"]);
  assert.equal(kit.forwarded[0]?.type === "text" && "quiet" in kit.forwarded[0], false);
  const end = kit.forwarded[1];
  assert.equal(end?.type === "end" ? end.quiet : undefined, true);
  assert.equal(kit.message().quiet, true);
  assert.equal(kit.message().status, "done");
});

test("an end that quiet_end does not silence and an emitter without quiet_end carry no quiet flag", () => {
  for (const kit of [harness(() => false), harness()]) {
    kit.emit({ type: "end", status: "done", error: null });
    assert.equal("quiet" in (kit.forwarded[0] ?? {}), false);
    assert.equal(kit.message().quiet, undefined);
  }
});

const end_event = (quiet: boolean): TurnEvent => ({ chat_id: "c1", message_id: "m1", seq: 2, at: 0, type: "end", status: "done", error: null, ...(quiet ? { quiet: true as const } : {}) });

test("a quiet end neither chimes nor marks the chat unread, a new-activity end does both", () => {
  assert.equal(chime_for(end_event(true)), null);
  assert.equal(chime_for(end_event(false)), "finished");
  assert.equal(row_status(mark_event({}, end_event(true), false).c1, false), "idle");
  assert.equal(row_status(mark_event({}, end_event(false), false).c1, false), "unread");
});
