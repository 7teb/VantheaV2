import assert from "node:assert/strict";
import { test } from "node:test";
import { apply_events } from "../shared/apply-event.ts";
import type { AssistantMessage, ReasoningStep } from "../shared/chat.ts";
import type { Sequenced, StreamEventBody } from "../shared/events.ts";
import { reasoning_head, thought_description } from "../src/features/chat/reasoning-head.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const en: Translate = (key, vars) => translate("en", key, vars);

const de: Translate = (key, vars) => translate("de", key, vars);

const fresh = (): AssistantMessage => ({
  id: "m1",
  role: "assistant",
  model: "openai/gpt-5.5",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-15T10:00:00.000Z",
  ended_at: null,
  status: "streaming",
  steps: [],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

const play = (bodies: StreamEventBody[], from: AssistantMessage = fresh()): AssistantMessage =>
  apply_events(
    from,
    bodies.map((body, index): Sequenced & StreamEventBody => ({ ...body, seq: from.last_seq + index + 1, at: 1000 * (from.last_seq + index + 1) })),
  );

const reasoning_of = (message: AssistantMessage): ReasoningStep | undefined => message.steps.find((step): step is ReasoningStep => step.kind === "reasoning");

test("a route that streams reasoning text shows the status line while it streams and an expandable row", () => {
  const streaming = play([
    { type: "reasoning", round: 0, delta: "Reading **store.ts** and the queue." },
    { type: "reasoning_status", round: 0, text: "Reading the chat store and its save queue." },
  ]);
  const step = reasoning_of(streaming);
  assert.ok(step);
  assert.deepEqual(reasoning_head(en, step, true), { label: "Reading the chat store and its save queue.", status: "Reading the chat store and its save queue.", expandable: true, working: true });
  const before_status = reasoning_of(play([{ type: "reasoning", round: 0, delta: "Reading store.ts" }]));
  assert.ok(before_status);
  assert.deepEqual(reasoning_head(de, before_status, true), { label: "Denkt nach", status: undefined, expandable: true, working: true });
  const finished = reasoning_of(play([{ type: "text", round: 0, delta: "Answer" }], streaming));
  assert.ok(finished);
  const bare = { ...finished, status_line: undefined };
  assert.deepEqual(reasoning_head(en, bare, true), { label: "Thought", status: undefined, expandable: true, working: false });
  assert.equal(reasoning_head(de, bare, false).label, "Nachgedacht");
  const described = { ...finished, status_line: "Reading the chat store and its save queue." };
  assert.deepEqual(reasoning_head(en, described, true), { label: "Reading the chat store and its save queue.", status: undefined, expandable: true, working: false });
});

test("a route that sends only blank or hidden reasoning shows plain Thinking without a chevron, never a status line", () => {
  const blank = play([{ type: "reasoning", round: 0, delta: "\n\n" }]);
  const step = reasoning_of(blank);
  assert.ok(step);
  assert.deepEqual(reasoning_head(en, step, true), { label: "Thinking", status: undefined, expandable: false, working: true });
  assert.equal(reasoning_head(de, step, true).label, "Denkt nach");
  assert.equal(reasoning_of(play([{ type: "text", round: 0, delta: "Answer" }], blank)), undefined);
  assert.equal(reasoning_of(play([{ type: "reasoning_status", round: 0, text: "Reading config.json." }])), undefined);
});

test("a finished step stored without reasoning text keeps its finished wording and stays closed", () => {
  const stored: ReasoningStep = { id: "reasoning:1", round: 0, kind: "reasoning", text: "", started_at: 1000, ended_at: 4000 };
  assert.deepEqual(reasoning_head(en, stored, false), { label: "Thought", status: undefined, expandable: false, working: false });
  const cut_short: ReasoningStep = { ...stored, ended_at: null, text: "Partial" };
  assert.deepEqual(reasoning_head(en, cut_short, false), { label: "Thought", status: undefined, expandable: true, working: false });
});

const thought = (text: string, status_line?: string): ReasoningStep => ({ id: "reasoning:9", round: 0, kind: "reasoning", text, started_at: 1000, ended_at: 7000, ...(status_line ? { status_line } : {}) });

test("a finished thought is described by its status line, else its last heading or standalone bold line outside code", () => {
  assert.equal(thought_description(thought("**Planning**\n\nI open store.ts.", "Checking how the packer writes the trailer")), "Checking how the packer writes the trailer");
  assert.equal(thought_description(thought("**Reading the store**\n\nI open store.ts.\n\n**Comparing with `save_queue`**\n\nThe queue flushes.")), "Comparing with save_queue");
  assert.equal(thought_description(thought("## Plan\n\nFirst the parser.\n\n### Next step ###\n")), "Next step");
  assert.equal(thought_description(thought("__Checking the trailer__:")), "Checking the trailer");
  assert.equal(thought_description(thought("I read **store.ts** and **queue.ts** now.")), null);
  assert.equal(thought_description(thought("**store.ts** and **queue.ts**")), null);
  assert.equal(thought_description(thought("```python\n# not a heading\n**nor this**\n```\nplain text")), null);
  assert.equal(thought_description(thought("#hashtag only")), null);
  const long = thought_description(thought(`**${"trailer ".repeat(30)}**`));
  assert.equal(long?.length, 120);
  assert.ok(long?.endsWith("…"));
});

test("a described thought shows its description without a time, an undescribed one says Thought, and a live one keeps Thinking", () => {
  assert.deepEqual(reasoning_head(en, thought("**Checking the trailer**\n\nThe packer writes it first."), false), { label: "Checking the trailer", status: undefined, expandable: true, working: false });
  assert.deepEqual(reasoning_head(de, thought("Nothing to name here."), false), { label: "Nachgedacht", status: undefined, expandable: true, working: false });
  assert.deepEqual(reasoning_head(en, { ...thought("**Checking the trailer**"), ended_at: null }, false), { label: "Checking the trailer", status: undefined, expandable: true, working: false });
  assert.deepEqual(reasoning_head(en, { ...thought("**Checking the trailer**"), ended_at: null }, true), { label: "Thinking", status: undefined, expandable: true, working: true });
  assert.deepEqual(reasoning_head(en, { ...thought("", "Reading the packer"), ended_at: null }, true), { label: "Reading the packer", status: "Reading the packer", expandable: false, working: true });
});
