import assert from "node:assert/strict";
import { test } from "node:test";
import type { StreamEventBody, TurnEvent } from "../shared/events.ts";
import { default_settings, merge_settings, normalize_settings } from "../electron/settings/validate.ts";
import { chime_for } from "../src/state/chime-rules.ts";

const event = (body: StreamEventBody): TurnEvent => ({ chat_id: "c1", message_id: "m1", seq: 1, at: 0, ...body });

const ended = (status: "done" | "failed" | "interrupted" | "blocked" | "stopped", kind?: string): TurnEvent =>
  event({ type: "end", status, error: kind ? ({ kind, message: "x" } as Extract<StreamEventBody, { type: "end" }>["error"]) : null });

test("every turn end chimes except a stop by the user and an app shutdown", () => {
  assert.equal(chime_for(ended("done")), "finished");
  assert.equal(chime_for(ended("failed", "http")), "finished");
  assert.equal(chime_for(ended("interrupted", "stream_interrupted")), "finished");
  assert.equal(chime_for(ended("blocked", "policy")), "finished");
  assert.equal(chime_for(ended("stopped")), null);
  assert.equal(chime_for(ended("interrupted", "app_closed")), null);
});

test("a question or an approval card for the user chimes, other events do not", () => {
  assert.equal(chime_for(event({ type: "tool_end", call_id: "a", status: "done", view: { kind: "questions", questions: [] }, error: null, result_text: "" })), "attention");
  assert.equal(chime_for(event({ type: "tool_end", call_id: "b", status: "done", view: { kind: "text", text: "x" }, error: null, result_text: "" })), null);
  assert.equal(chime_for(event({ type: "tool_approval", call_id: "c", request: {} as Extract<StreamEventBody, { type: "tool_approval" }>["request"] })), "attention");
  assert.equal(chime_for(event({ type: "text", round: 0, delta: "hi" } as StreamEventBody)), null);
});

test("the notification sound is on by default and a stored off survives loading and patching", () => {
  assert.equal(default_settings().notification_sound, true);
  assert.equal(normalize_settings({ notification_sound: false }, default_settings()).notification_sound, false);
  assert.equal(normalize_settings({ notification_sound: "no" }, default_settings()).notification_sound, true);
  assert.equal(merge_settings(default_settings(), { notification_sound: false }).notification_sound, false);
});
