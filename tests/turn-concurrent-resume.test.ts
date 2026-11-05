import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApprovalRequest } from "../shared/approval.ts";
import type { AssistantMessage, Message, UserMessage } from "../shared/chat.ts";
import type { StreamEventBody, TurnEvent } from "../shared/events.ts";
import { settle_streaming } from "../electron/chats/settle.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import { image_url } from "../electron/turn/carriers.ts";
import { create_emitter } from "../electron/turn/emit.ts";
import { build_api_messages } from "../electron/turn/history.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import { build_blocks, type Block } from "../src/features/chat/assistant-blocks.ts";
import { group_head } from "../src/features/tools/group-head.ts";
import { translate } from "../src/i18n/translate.ts";
import { apply_delivery } from "../src/state/chat-view-reduce.ts";
import { asked, assert_tool_protocol, calls_of, done, ended, parallel, scripted, tool_contents, watch } from "./concurrent-kit.ts";
import { harness, model, transcript, use_media_root } from "./turn-loop-harness.ts";

use_media_root();

const vision = { ...model, vision: true };

const user = (id: string, text: string): UserMessage => ({ id, role: "user", text, attachments: [], origin: "user", created_at: "2026-10-30T10:00:00.000Z" });

const fresh = (): AssistantMessage => ({
  id: "m",
  role: "assistant",
  model: "m",
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

const stored = new Map<string, string>();

const read_stored = async (key: string) => stored.get(key) ?? "";

const replay = (messages: Message[]) => build_api_messages({ system: "s", summary: null, messages, model: vision, agent_tools: true }, read_stored);

const hangs = parallel("hangs", (ctx) => new Promise((_resolve, reject) => ctx.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })));

const after_tools = (messages: ApiMessage[]) => {
  const at = messages.findIndex((message) => message.role === "assistant" && Boolean(message.tool_calls?.length));
  const count = messages[at]?.role === "assistant" ? (messages[at].tool_calls?.length ?? 0) : 0;
  return messages.slice(at + 1 + count);
};

test("a chat saved while a batch ran replays every call of the batch in tool_calls order after the reload", async () => {
  const { stream } = scripted(calls_of(["hangs", "quick", "hangs"]));
  const h = harness(stream, []);
  h.session.model = vision;
  h.session.store_images = async (images) =>
    images.map((image) => {
      const key = `img_resume_${stored.size}.png`;
      stored.set(key, image_url(image.bytes, image.mime));
      return key;
    });
  const until = watch(h);
  h.session.resolve_tools = () => [hangs, parallel("quick", async () => done("quick result", { images: [{ bytes: Buffer.from("png"), mime: "image/png", label: "[Image q]" }] }))];
  let saved: StreamEventBody[] = [];
  void until(ended("c0_1")).then(() => {
    saved = [...h.events];
    h.controller.abort(new Error("the app was closed"));
  });
  await run_turn_loop(h.session, h.messages);
  const partial = transcript(saved);
  assert.equal(partial.status, "streaming");
  const settled = settle_streaming([user("u1", "go"), partial], 99);
  assert.ok(settled);
  const reloaded = settled[1];
  assert.ok(reloaded?.role === "assistant");
  assert.equal(reloaded.status, "interrupted");
  assert.equal(reloaded.steps.some((step) => step.kind === "tool" && ["queued", "running", "awaiting_approval"].includes(step.status)), false);
  const messages = await replay([...settled, user("u2", "next")]);
  assert_tool_protocol(messages);
  assert.deepEqual(tool_contents(messages), ["[no result]", "quick result", "[no result]"]);
  const rest = after_tools(messages);
  assert.equal(rest[0]?.role === "user" && rest[0].tool_images, true);
  assert.deepEqual(
    rest.slice(1).map((message) => (message.role === "user" && typeof message.content === "string" ? message.content : message.role)),
    ["[The previous turn was interrupted before it finished.]", "next"],
  );
});

test("an app quit during a batch leaves one end, drops the late result of a call that ignored the abort and stores a valid history", async () => {
  const { stream, requests } = scripted(calls_of(["hangs", "quick", "stubborn"]));
  let message = fresh();
  const forwarded: TurnEvent[] = [];
  let on_forward: (event: TurnEvent) => void = () => undefined;
  const emit = create_emitter("chat-quit", "m", {
    update_message: (_chat_id, _message_id, fn) => {
      const next = fn(message);
      assert.ok(next.role === "assistant");
      message = next;
    },
    forward: (event) => {
      forwarded.push(event);
      on_forward(event);
    },
    flush: () => undefined,
  });
  const h = harness(stream, []);
  h.session.emit = emit;
  h.session.resolve_tools = () => [
    hangs,
    parallel("quick", async () => done("quick result")),
    parallel("stubborn", async (ctx) => {
      await new Promise((resolve) => ctx.signal.addEventListener("abort", resolve, { once: true }));
      return done("late result");
    }),
  ];
  on_forward = (event) => {
    if (event.type === "tool_end" && event.call_id === "c0_1") {
      h.controller.abort(new Error("The app was closed while this turn was still running."));
      emit({ type: "end", status: "interrupted", error: { kind: "app_closed", message: "The app was closed while this turn was still running." } });
    }
  };
  await run_turn_loop(h.session, h.messages);
  assert.equal(requests.length, 1);
  assert.equal(forwarded.filter((event) => event.type === "end").length, 1);
  assert.equal(forwarded.at(-1)?.type, "end");
  assert.equal(message.status, "interrupted");
  assert.deepEqual(
    message.steps.flatMap((step) => (step.kind === "tool" ? [[step.call_id, step.status]] : [])),
    [
      ["c0_0", "cancelled"],
      ["c0_1", "done"],
      ["c0_2", "cancelled"],
    ],
  );
  const messages = await replay([user("u1", "go"), message, user("u2", "next")]);
  assert_tool_protocol(messages);
  assert.deepEqual(tool_contents(messages), ["[no result]", "quick result", "[no result]"]);
});

test("the renderer copy applies interleaved events of two approvals and a running sibling the same way as main, also after loading mid-turn", async () => {
  const request: ApprovalRequest = { kind: "memory", action: "remember", text: "x" };
  const { stream } = scripted(calls_of(["asks", "reads", "asks"]));
  const h = harness(stream, []);
  const until = watch(h);
  const pending = new Map<string, (approved: boolean) => void>();
  h.session.wait_decision = (call_id) => new Promise((resolve) => pending.set(call_id, (approved) => resolve({ approved, grant: "once", feedback: "" })));
  const asks = parallel("asks", async (ctx) => {
    const decision = await ctx.approve(request);
    return decision.approved ? done("asked and ran") : { status: "denied", text: "asked and denied", view: null };
  });
  const head_labels: string[] = [];
  h.session.resolve_tools = () => [
    asks,
    parallel("reads", async () => {
      await Promise.all([until(asked("c0_0")), until(asked("c0_2"))]);
      const work = build_blocks(transcript(h.events).steps).findLast((block): block is Extract<Block, { kind: "work" }> => block.kind === "work");
      const head = work ? group_head((key, vars) => translate("en", key, vars), work.steps, true) : null;
      head_labels.push(head && head.kind === "tool" ? head.label : "");
      pending.get("c0_2")?.(false);
      await until(ended("c0_2"));
      pending.get("c0_0")?.(true);
      await until((event) => event.type === "tool_start" && event.call_id === "c0_0" && h.events.filter((entry) => entry.type === "tool_start" && entry.call_id === "c0_0").length === 2);
      return done("read result");
    }),
  ];
  await run_turn_loop(h.session, h.messages);
  assert.equal(head_labels.length, 1);
  assert.match(head_labels[0] ?? "", / and 2 more$/);
  const main = transcript(h.events);
  const deliveries = h.events.map((body, index) => ({ kind: "event" as const, partial: false, event: { ...body, seq: index + 1, at: index + 1, chat_id: "c", message_id: "m" } }));
  assert.deepEqual(deliveries.reduce(apply_delivery, fresh()), main);
  const cut = h.events.findIndex(ended("c0_2"));
  const loaded = transcript(h.events.slice(0, cut + 1));
  assert.deepEqual(deliveries.reduce(apply_delivery, loaded), main);
  assert.deepEqual(
    main.steps.flatMap((step) => (step.kind === "tool" ? [[step.call_id, step.status, step.decisions?.length ?? 0]] : [])),
    [
      ["c0_0", "done", 1],
      ["c0_1", "done", 0],
      ["c0_2", "denied", 1],
    ],
  );
});
