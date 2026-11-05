import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Message, Step, Todo, UserMessage } from "../shared/chat.ts";
import type { ModelEntry } from "../shared/models.ts";
import { latest_todos, newly_done, open_todos } from "../shared/todos.ts";
import { carried_todos_content, carried_todos_note } from "../electron/turn/carried-todos.ts";
import { build_api_messages } from "../electron/turn/history.ts";
import { build_blocks } from "../src/features/chat/assistant-blocks.ts";

const model: ModelEntry = {
  id: "m",
  label: "M",
  provider: "p",
  provider_order: [],
  efforts: ["high"],
  default_effort: "high",
  vision: false,
  context_length: 1_000_000,
  max_output: 4096,
  reasoning_passback: false,
};

const user = (id: string, text: string): UserMessage => ({ id, role: "user", text, attachments: [], origin: "user", created_at: "2026-10-15T10:00:00.000Z" });

const todos_step = (round: number, todos: Todo[]): Step => ({
  id: `tool:${round}:0`,
  round,
  kind: "tool",
  index: 0,
  call_id: `c${round}_0`,
  name: "update_todos",
  args: { todos },
  status: "done",
  progress: null,
  approval: null,
  view: { kind: "todos", todos },
  error: null,
  result_text: "Todos updated",
  started_at: 1,
  ended_at: 2,
});

const assistant = (id: string, steps: Step[], status: AssistantMessage["status"] = "done"): AssistantMessage => ({
  id,
  role: "assistant",
  model: "m",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-15T10:00:01.000Z",
  ended_at: status === "streaming" ? null : "2026-10-15T10:00:05.000Z",
  status,
  steps,
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

const list: Todo[] = [
  { id: "todo-1", text: "Read the parser", status: "done" },
  { id: "todo-2", text: "Fix the tokenizer", status: "in_progress" },
  { id: "todo-3", text: "Run the tests", status: "pending" },
];

test("the newest todo list wins and says whether its turn still streams", () => {
  const older: Todo[] = [{ id: "todo-1", text: "Old step", status: "pending" }];
  const messages: Message[] = [user("u1", "go"), assistant("a1", [todos_step(0, older)]), user("u2", "more"), assistant("a2", [todos_step(0, list)], "streaming")];
  assert.deepEqual(latest_todos(messages), { todos: list, streaming: true });
  assert.deepEqual(latest_todos(messages.slice(0, 3)), { todos: older, streaming: false });
  assert.equal(latest_todos([user("u1", "hi")]), null);
  assert.deepEqual(
    open_todos(list).map((todo) => todo.id),
    ["todo-2", "todo-3"],
  );
});

test("only items that just turned done count as finished, never on a first look", () => {
  const next: Todo[] = list.map((todo) => (todo.id === "todo-2" ? { ...todo, status: "done" } : todo));
  assert.deepEqual([...newly_done(list, next)], ["todo-2"]);
  assert.deepEqual([...newly_done(next, next)], []);
  assert.deepEqual([...newly_done([], next)], []);
});

test("open todos of an earlier turn become one todos_carried note with the open items", () => {
  const note = carried_todos_note([user("u1", "go"), assistant("a1", [todos_step(0, list)]), user("u2", "next request")]);
  assert.ok(note);
  assert.equal(note.kind, "notice");
  assert.equal(note.kind === "notice" && note.notice, "todos_carried");
  assert.equal(note.text, "Fix the tokenizer\nRun the tests");
  assert.equal(note.content, carried_todos_content(note.text));
  assert.match(note.content, /^Your task list from an earlier turn still has open items, and the user still sees them above the input box:\n- Fix the tokenizer\n- Run the tests\n/);
  assert.match(note.content, /call update_todos before your final answer/);
});

test("a closed or cleared list carries nothing", () => {
  const closed = list.map((todo) => ({ ...todo, status: "done" as const }));
  assert.equal(carried_todos_note([user("u1", "go"), assistant("a1", [todos_step(0, closed)]), user("u2", "next")]), null);
  assert.equal(carried_todos_note([user("u1", "go"), assistant("a1", [todos_step(0, list), todos_step(1, [])]), user("u2", "next")]), null);
  assert.equal(carried_todos_note([user("u1", "go")]), null);
});

test("a carried note is replayed in history at the same place the turn saw it", async () => {
  const notice: Step = { id: "notice:1", round: 0, kind: "notice", notice: "todos_carried", text: "Run the tests" };
  const text: Step = { id: "text:2", round: 0, kind: "text", text: "Continuing." };
  const messages: Message[] = [user("u1", "go on"), assistant("a1", [notice, text])];
  const api = await build_api_messages({ system: "sys", summary: null, messages, model, agent_tools: false });
  const contents = api.map((entry) => (typeof entry.content === "string" ? entry.content : null));
  const at = contents.indexOf(carried_todos_content("Run the tests"));
  assert.ok(at > 0, JSON.stringify(contents));
  assert.equal(api[at - 1]?.role, "user");
  assert.equal(api[at + 1]?.role, "assistant");
});

test("the carried todos note reaches the model but never shows in the chat", () => {
  const notice: Step = { id: "notice:1", round: 0, kind: "notice", notice: "todos_carried", text: "Run the tests" };
  const text: Step = { id: "text:2", round: 0, kind: "text", text: "Continuing." };
  assert.deepEqual(build_blocks([notice, text]).map((block) => block.kind), ["text"]);
});
