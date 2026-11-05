import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Message, ToolStep, UserMessage, UserOrigin } from "../shared/chat.ts";
import { answer_text, open_questions, question_id, type AskQuestion } from "../shared/questions.ts";

const user = (id: string, origin: UserOrigin = "user"): UserMessage => ({ id, role: "user", text: id, attachments: [], origin, created_at: "2026-10-10T10:00:00.000Z" });

const ask_step = (call_id: string, questions: AskQuestion[], status: ToolStep["status"] = "done"): ToolStep => ({
  id: `tool:0:${call_id}`,
  round: 0,
  kind: "tool",
  index: 0,
  call_id,
  name: "ask_user",
  args: { questions },
  status,
  progress: null,
  approval: null,
  view: status === "done" ? { kind: "questions", questions } : null,
  error: null,
  result_text: "",
  started_at: 1,
  ended_at: 2,
});

const assistant = (id: string, steps: ToolStep[]): AssistantMessage => ({
  id,
  role: "assistant",
  model: "m",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-10T10:00:01.000Z",
  ended_at: "2026-10-10T10:00:02.000Z",
  status: "done",
  steps,
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 1,
});

const runner: AskQuestion = { title: "Which runner?", options: ["node --test", "vitest"] };
const port: AskQuestion = { title: "Which port?", options: [] };
const name: AskQuestion = { title: "Which name?", options: ["a"] };

const ids = (messages: Message[], states = {}) => open_questions(messages, states).map((question) => question.id);

test("open questions have stable ids in transcript order and start after the last human message", () => {
  assert.equal(question_id("m1", "c0_1", 2), "m1:c0_1:2");
  const messages: Message[] = [
    user("u1"),
    assistant("a1", [ask_step("c0_0", [name])]),
    user("u2"),
    assistant("a2", [ask_step("c0_0", [runner, port]), ask_step("c1_0", [name])]),
    assistant("a3", [ask_step("c0_0", [port])]),
  ];
  assert.deepEqual(ids(messages), ["a2:c0_0:0", "a2:c0_0:1", "a2:c1_0:0", "a3:c0_0:0"]);
  const first = open_questions(messages, {})[0];
  assert.deepEqual(first, { title: "Which runner?", options: ["node --test", "vitest"], id: "a2:c0_0:0", message_id: "a2", call_id: "c0_0", index: 0 });
  assert.deepEqual(ids([...messages, user("u3", "plan_accept")]), []);
  assert.deepEqual(ids([...messages, user("u3")]), []);
});

test("internal and continue messages do not close questions", () => {
  const asked = assistant("a1", [ask_step("c0_0", [runner])]);
  for (const origin of ["agent_report", "agent_update", "background", "continue"] as const) {
    assert.deepEqual(ids([user("u1"), asked, user("x", origin), assistant("a2", [])]), ["a1:c0_0:0"], origin);
  }
});

test("failed, cancelled and running ask_user steps give nothing", () => {
  const messages: Message[] = [
    user("u1"),
    assistant("a1", [ask_step("c0_0", [runner], "failed"), ask_step("c0_1", [runner], "cancelled"), ask_step("c0_2", [runner], "running")]),
  ];
  assert.deepEqual(ids(messages), []);
});

test("every stored state closes a question", () => {
  const messages: Message[] = [user("u1"), assistant("a1", [ask_step("c0_0", [runner, port, name])])];
  assert.deepEqual(ids(messages, { "a1:c0_0:0": "sending", "a1:c0_0:1": "answered", "a1:c0_0:2": "dismissed" }), []);
  assert.deepEqual(ids(messages, { "a1:c0_0:1": "answered" }), ["a1:c0_0:0", "a1:c0_0:2"]);
});

test("answer_text quotes each answered question and leaves out skipped ones", () => {
  assert.equal(answer_text([{ title: "Which runner?", answer: "node --test" }]), 'Answer to your question "Which runner?":\nnode --test');
  assert.equal(
    answer_text([
      { title: "Which runner?", answer: "node --test" },
      { title: "Which port?", answer: "  8080\n" },
    ]),
    'Answer to your question "Which runner?":\nnode --test\n\nAnswer to your question "Which port?":\n8080',
  );
  assert.equal(
    answer_text([
      { title: "Which runner?", answer: "" },
      { title: "Which port?", answer: "8080" },
      { title: "Which name?", answer: "   " },
    ]),
    'Answer to your question "Which port?":\n8080',
  );
});
