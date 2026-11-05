import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage } from "../shared/chat.ts";
import { sent_estimate } from "../electron/context/calibration.ts";
import { estimate_tokens } from "../electron/context/estimate.ts";
import { is_note_call } from "./turn-compaction-harness.ts";
import { ask, contexts, new_chat, provider, reload_from_disk, run_chat_turn, scale_of, window_model, working_calls, type ChatState } from "./turn-calibration-harness.ts";
import { completed, tool_call, use_media_root } from "./turn-loop-harness.ts";

use_media_root();

const x = window_model("x");

const long_answer = "y".repeat(25_600);

const last_assistant = (chat: ChatState): AssistantMessage => {
  const last = chat.messages.at(-1);
  assert.ok(last?.role === "assistant");
  return last;
};

const answered_chat = async (ratio = 1.12, answer = long_answer): Promise<ChatState> => {
  const chat = new_chat();
  ask(chat, "Wie funktioniert Kompression?");
  const { stream } = provider(ratio, () => ({ content: answer }));
  await run_chat_turn(chat, x, stream);
  return chat;
};

test("the first turn of a chat measures with the estimate and calibrates from its first round", async () => {
  const chat = new_chat();
  ask(chat, "Wie funktioniert Kompression?");
  const { calls, stream } = provider(1.12, () => ({ content: long_answer }));
  const { message, events } = await run_chat_turn(chat, x, stream);
  const [check, after] = contexts(events);
  const sent = sent_estimate((calls[0]?.messages ?? []), calls[0]?.request.tools ?? [], x);
  assert.equal(check?.calibration, undefined);
  assert.equal(check?.used, sent);
  const prompt_tokens = Math.round(sent * 1.12);
  assert.deepEqual(after?.calibration, { prompt_tokens, estimate: sent });
  assert.equal(after?.used, Math.ceil(((sent + estimate_tokens(long_answer)) * prompt_tokens) / sent));
  assert.deepEqual(message.context, after);
});

test("a one-round question at about 72 percent of the real count compacts before the model call although the estimate stays under 70 percent", async () => {
  const chat = await answered_chat();
  ask(chat, "Was genau ist LZMA?");
  const { calls, stream } = provider(1.12, () => ({ content: "LZMA ist ein Kompressionsverfahren." }));
  const { events } = await run_chat_turn(chat, x, stream);
  const [check] = contexts(events);
  assert.ok(check && check.used > x.context_length * 0.7);
  assert.ok(sent_estimate((calls[0]?.messages ?? []).slice(0, -1), calls[0]?.request.tools ?? [], x) < x.context_length * 0.7);
  assert.ok(is_note_call(calls[0]?.request ?? ({} as never)));
  assert.equal(chat.summary?.through_round, -1);
  const answered = working_calls(calls)[0];
  assert.ok(answered);
  assert.equal(answered.messages.some((message) => message.content === long_answer), true);
  assert.ok(answered.messages.some((message) => message.role === "user" && message.content === "Was genau ist LZMA?"));
  assert.deepEqual(
    events.flatMap((event) => (event.type === "compaction" ? [`${event.round}:${event.status}`] : [])),
    ["0:running", "0:done"],
  );
});

test("a one-round question at 69 percent of the real count runs without compaction and the ring ends on the answer's measure", async () => {
  const chat = await answered_chat(1.12, "y".repeat(24_000));
  ask(chat, "Was genau ist LZMA?");
  const answer = "z".repeat(400);
  const { calls, stream } = provider(1.12, () => ({ content: answer }));
  const { message, events } = await run_chat_turn(chat, x, stream);
  assert.equal(calls.length, 1);
  const [check, after] = contexts(events);
  assert.ok(check && check.used < x.context_length * 0.7 && check.used > x.context_length * 0.66);
  const sent = sent_estimate(calls[0]?.messages ?? [], calls[0]?.request.tools ?? [], x);
  assert.equal(after?.used, Math.ceil((sent + estimate_tokens(answer)) * scale_of(after)));
  assert.deepEqual(message.context, after);
});

test("after an app restart an interrupted turn keeps its calibration and Continue compacts at round 0", async () => {
  const chat = new_chat();
  ask(chat, "Wie funktioniert Kompression?");
  const first = provider(1.12, () => ({ content: long_answer }));
  await run_chat_turn(chat, x, first.stream, { keep: (events) => events.filter((event) => event.type !== "end") });
  const loaded = reload_from_disk(chat);
  const last = loaded.messages.at(-1);
  assert.equal(last?.role === "assistant" && last.status, "interrupted");
  assert.equal(last?.role === "assistant" && last.error?.kind, "app_closed");
  assert.ok(last?.role === "assistant" && last.context?.calibration);
  ask(loaded, "Continue", "continue");
  const { calls, stream } = provider(1.12, () => ({ content: "weiter" }));
  const { events } = await run_chat_turn(loaded, x, stream);
  assert.ok(is_note_call(calls[0]?.request ?? ({} as never)));
  assert.ok((contexts(events)[0]?.used ?? 0) > x.context_length * 0.7);
});

test("a newer turn that failed before its first check leaves the older calibration in charge", async () => {
  const chat = await answered_chat(1.3, "y".repeat(4000));
  const calibrated = last_assistant(chat);
  ask(chat, "noch eine Frage");
  chat.messages.push({ ...calibrated, id: "failed-turn", status: "failed", steps: [], context: null, error: { kind: "internal", message: "chat gone" } });
  ask(chat, "und noch eine");
  const { stream } = provider(1, () => ({ content: "ok" }));
  const { events } = await run_chat_turn(chat, x, stream);
  assert.ok(calibrated.context?.calibration);
  assert.deepEqual(contexts(events)[0]?.calibration, calibrated.context.calibration);
});

test("a model switch measures the new model with the estimate against its own window and switching back reuses the old calibration", async () => {
  const chat = await answered_chat(1.12, "y".repeat(4000));
  const x_calibration = last_assistant(chat).context?.calibration;
  assert.ok(x_calibration);
  const y = window_model("y", 8000);
  ask(chat, "andere Frage");
  const on_y = provider(0.9, () => ({ content: "y answer" }));
  const y_turn = await run_chat_turn(chat, y, on_y.stream);
  const [y_check, y_after] = contexts(y_turn.events);
  assert.equal(y_check?.calibration, undefined);
  assert.equal(y_check?.floor, 0);
  assert.equal(y_check?.limit, 8000);
  assert.ok(y_after?.calibration && Math.abs(scale_of(y_after) - 0.9) < 0.01);
  ask(chat, "zurück zu x");
  const on_x = provider(1.12, () => ({ content: "x answer" }));
  const x_turn = await run_chat_turn(chat, x, on_x.stream);
  assert.deepEqual(contexts(x_turn.events)[0]?.calibration, x_calibration);
  assert.equal(contexts(x_turn.events)[0]?.floor, 0);
});

test("a switch to a smaller window compacts at round 0 measured against that window, with the note fitted into 90 percent of it", async () => {
  const chat = await answered_chat(1.12, "y".repeat(24_000));
  const z = window_model("z", 8000);
  ask(chat, "kleineres Modell");
  const { calls, stream } = provider(1, () => ({ content: "ok" }));
  const { events } = await run_chat_turn(chat, z, stream);
  const [check] = contexts(events);
  assert.equal(check?.limit, 8000);
  assert.equal(check?.calibration, undefined);
  const note = calls[0];
  assert.ok(note && is_note_call(note.request));
  assert.ok(sent_estimate(note.messages, note.request.tools, z) <= 8000 * 0.9);
});

test("a stop during the stream ends stopped without a new calibration and the message keeps the one it was seeded with", async () => {
  const chat = await answered_chat(1.12, "y".repeat(4000));
  const seeded = last_assistant(chat).context?.calibration;
  assert.ok(seeded);
  ask(chat, "lange Antwort bitte");
  let abort = () => undefined as void;
  const stream = async () => {
    abort();
    return completed({ status: "cancelled", content: "halb" });
  };
  const { message } = await run_chat_turn(chat, x, stream as never, {
    prepare: (h) => {
      abort = () => h.controller.abort(new Error("stop"));
    },
  });
  assert.equal(message.status, "stopped");
  assert.deepEqual(message.context?.calibration, seeded);
});

test("a stop during the tools of a completed stream still takes that round's calibration", async () => {
  const chat = await answered_chat(1.12, "y".repeat(4000));
  ask(chat, "lies die Datei");
  let abort = () => undefined as void;
  const { calls, stream } = provider(1.5, () => ({ tool_calls: [tool_call("read_file")], finish_reason: "tool_calls" }));
  const { message } = await run_chat_turn(chat, x, stream, {
    prepare: (h) => {
      abort = () => h.controller.abort(new Error("stop"));
      h.session.resolve_tools = () => [
        {
          spec: { name: "read_file", description: "", parameters: { type: "object", properties: {} } },
          profiles: ["main"],
          available: () => true,
          execute: async () => {
            abort();
            throw new Error("aborted");
          },
        },
      ];
    },
  });
  assert.equal(message.status, "stopped");
  const sent = sent_estimate(calls[0]?.messages ?? [], calls[0]?.request.tools ?? [], x);
  assert.deepEqual(message.context?.calibration, { prompt_tokens: Math.round(sent * 1.5), estimate: sent });
});
