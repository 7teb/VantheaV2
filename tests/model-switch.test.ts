import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Message, Step, UserMessage } from "../shared/chat.ts";
import type { ModelCatalog, ModelEntry } from "../shared/models.ts";
import { build_api_messages } from "../electron/turn/history.ts";
import { model_switch_content, model_switch_note } from "../electron/turn/model-switch.ts";
import { build_blocks } from "../src/features/chat/assistant-blocks.ts";

const entry = (id: string, label: string): ModelEntry => ({
  id,
  label,
  provider: "p",
  provider_order: [],
  efforts: ["high"],
  default_effort: "high",
  vision: false,
  context_length: 1_000_000,
  max_output: 4096,
  reasoning_passback: false,
});

const gemini = entry("google/gemini-3.8-flash", "Gemini 3.8 Flash");
const deepseek = entry("deepseek/deepseek-v4.1-flash-1017", "DeepSeek V4.1 Flash");
const catalog = { models: [gemini, deepseek] } as unknown as ModelCatalog;

const user = (id: string): UserMessage => ({ id, role: "user", text: "next", attachments: [], origin: "user", created_at: "2026-11-01T10:00:00.000Z" });

const assistant = (id: string, model: string, steps: Step[] = [{ id: `text:${id}`, round: 0, kind: "text", text: "done" }]): AssistantMessage => ({
  id,
  role: "assistant",
  model,
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-11-01T10:00:00.000Z",
  ended_at: "2026-11-01T10:01:00.000Z",
  status: "done",
  steps,
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

test("a turn on another model than the last answer starts with a note naming both models", () => {
  const note = model_switch_note([user("u1"), assistant("a1", gemini.id), user("u2")], deepseek, catalog);
  assert.ok(note && note.kind === "notice");
  assert.equal(note.notice, "model_switch");
  assert.equal(note.text, "Gemini 3.8 Flash (google/gemini-3.8-flash)\nDeepSeek V4.1 Flash (deepseek/deepseek-v4.1-flash-1017)");
  assert.equal(note.content, model_switch_content(note.text));
  assert.match(note.content, /were written by Gemini 3\.8 Flash \(google\/gemini-3\.8-flash\)\./);
  assert.match(note.content, /written by you, DeepSeek V4\.1 Flash \(deepseek\/deepseek-v4\.1-flash-1017\)\./);
  const unknown = model_switch_note([user("u1"), assistant("a1", "vendor/gone"), user("u2")], deepseek, catalog);
  assert.equal(unknown?.text.split("\n")[0], "vendor/gone");
});

test("the same model, a first turn or an answer without a model id adds no note", () => {
  assert.equal(model_switch_note([user("u1"), assistant("a1", deepseek.id), user("u2")], deepseek, catalog), null);
  assert.equal(model_switch_note([user("u1")], deepseek, catalog), null);
  assert.equal(model_switch_note([user("u1"), assistant("a1", ""), user("u2")], deepseek, catalog), null);
});

test("the note is replayed at the place the turn saw it and never shows in the chat", async () => {
  const text = "Gemini 3.8 Flash (google/gemini-3.8-flash)\nDeepSeek V4.1 Flash (deepseek/deepseek-v4.1-flash-1017)";
  const notice: Step = { id: "notice:1", round: 0, kind: "notice", notice: "model_switch", text };
  const answer: Step = { id: "text:2", round: 0, kind: "text", text: "Continuing." };
  const messages: Message[] = [user("u1"), assistant("a1", gemini.id), user("u2"), assistant("a2", deepseek.id, [notice, answer])];
  const api = await build_api_messages({ system: "sys", summary: null, messages, model: deepseek, agent_tools: false });
  const contents = api.map((item) => (typeof item.content === "string" ? item.content : null));
  const at = contents.indexOf(model_switch_content(text));
  assert.ok(at > 0, JSON.stringify(contents));
  assert.equal(api[at - 1]?.role, "user");
  assert.equal(api[at + 1]?.role, "assistant");
  assert.deepEqual(build_blocks([notice, answer]).map((block) => block.kind), ["text"]);
});
