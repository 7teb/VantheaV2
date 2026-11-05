import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Chat, Message } from "../shared/chat.ts";
import type { Settings } from "../shared/settings.ts";
import { set_key_source } from "../electron/model/key.ts";
import { stream_round } from "../electron/model/stream.ts";
import type { Transport } from "../electron/model/transport.ts";
import type { Tool } from "../electron/tools/types.ts";
import { create_emitter } from "../electron/turn/emit.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import type { TurnSession } from "../electron/turn/session.ts";
import { create_smoother, type SmootherClock } from "../src/api/smoother.ts";
import { begin_load, finish_load, receive, empty_chat_view, type ChatViewState } from "../src/state/chat-view-reduce.ts";
import { load_recording, recording_names } from "./fixtures/live-code/recordings.ts";
import { body_of, chunk, model } from "./model-stream-harness.ts";
import { review_stub } from "./review-stub.ts";

set_key_source(() => "sk-or-test-key");

const placeholder = (): AssistantMessage => ({
  id: "a1",
  role: "assistant",
  model: model.id,
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-10T10:00:00.000Z",
  ended_at: null,
  status: "streaming",
  steps: [],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

const chat_of = (message: AssistantMessage): Chat => ({
  id: "c1",
  title: "t",
  project_path: "C:/p",
  workspace: "",
  pinned: false,
  created_at: "2026-10-10T10:00:00.000Z",
  updated_at: "2026-10-10T10:00:00.000Z",
  message_count: 1,
  streaming: true,
  summary: null,
  messages: [message],
  questions: {},
});

const draft_text = (message: Message | undefined): string | null => {
  const step = message?.role === "assistant" ? message.steps.find((entry) => entry.kind === "tool") : undefined;
  return step?.kind === "tool" ? (step.progress?.draft_text ?? null) : null;
};

const ui_message = (view: ChatViewState) => view.entries.c1?.chat?.messages[0];

for (const name of recording_names) {
  test(`recorded ${name} write_file travels main and renderer and both end with the same message`, async () => {
    const reads = load_recording(name).reads;
    const clock = { now: 0 };
    let posts = 0;
    const fetch_impl = async () => {
      posts += 1;
      const frames = posts === 1 ? reads.map((read) => ({ data: read.text, at: read.t })) : [{ data: chunk({ content: "Done." }, "stop"), at: 20000 }];
      return new Response(body_of(frames, clock), { status: 200 });
    };
    const transport: Partial<Transport> = { fetch: fetch_impl, now: () => clock.now, sleep: async () => {}, random: () => 0, first_byte_ms: 5000, idle_ms: 5000 };

    let ui_time = 0;
    let next_timer = 1;
    const timers = new Map<number, () => void>();
    const ui_clock: SmootherClock = {
      now: () => ui_time,
      schedule: (run) => {
        timers.set(next_timer, run);
        return next_timer++;
      },
      cancel: (handle) => {
        timers.delete(handle);
      },
      hidden: () => false,
    };
    let view = finish_load(begin_load(empty_chat_view, "c1"), "c1", chat_of(placeholder()));
    const ui_at_call: (string | null)[] = [];
    const smoother = create_smoother((batch) => {
      for (const delivery of batch) {
        if (delivery.kind === "event" && delivery.event.type === "tool_call") {
          ui_at_call.push(draft_text(ui_message(view)));
        }
        view = receive(view, [delivery]);
      }
    }, ui_clock);

    let main: Message = placeholder();
    let before: Message = main;
    const main_at_call: (string | null)[] = [];
    const emit = create_emitter("c1", "a1", {
      update_message: (_chat, _message, fn) => {
        before = main;
        main = fn(main);
      },
      forward: (event) => {
        if (event.type === "tool_call") {
          main_at_call.push(draft_text(before));
        }
        smoother.push({ kind: "event", event });
      },
      flush: () => {},
    });
    const written: Record<string, unknown>[] = [];
    const write_tool: Tool = {
      spec: { name: "write_file", description: "write", parameters: { type: "object", properties: {} } },
      profiles: ["main"],
      available: () => true,
      execute: async (_ctx, args) => {
        written.push(args);
        return { status: "done", text: "ok", view: null };
      },
    };
    const session: TurnSession = {
      compaction: { audience: "user", facts: async () => "" },
      chat_id: "c1",
      message_id: "a1",
      user_request: "write it",
      project_root: "C:/p",
      settings: {} as Settings,
      model,
      effort: "high",
      mode: "auto",
      plan: false,
      signal: new AbortController().signal,
      emit,
      stream: (request, callbacks, signal) => stream_round(request, callbacks, signal, transport),
      resolve_tools: () => [write_tool],
      side_model: async () => "",
      review: review_stub(),
      wait_decision: async () => ({ approved: true, grant: "once", feedback: "" }),
    };
    await run_turn_loop(session, [{ role: "system", content: "s" }, { role: "user", content: "write it" }]);
    for (let guard = 0; timers.size > 0 && guard < 10000; guard += 1) {
      ui_time += 16;
      const [handle, run] = [...timers.entries()][0];
      timers.delete(handle);
      run();
    }

    const content = written[0]?.content;
    assert.equal(typeof content, "string");
    assert.deepEqual(main_at_call, [content]);
    assert.deepEqual(ui_at_call, [content]);
    assert.equal(main.role === "assistant" && main.status, "done");
    assert.deepEqual(ui_message(view), main);
  });
}
