import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AssistantMessage, Chat, Todo, ToolStep } from "../shared/chat.ts";
import { bundle, card_stub, install_dom, quiet_vx, stub_components, type FakeElement } from "./dom-kit.ts";

const stubbed = ["AgentApprovals", "QuestionsPanel", "MemoriesPanel", "ComposerTab", "Composer"];
let client: any;
let container: FakeElement;
let root: any;
let restore = () => {};

const todo = (id: string, status: Todo["status"]): Todo => ({ id, text: `task ${id}`, status });

const todo_step = (todos: Todo[]): ToolStep => ({
  id: "t1",
  round: 0,
  kind: "tool",
  index: 0,
  call_id: "t1",
  name: "update_todos",
  args: {},
  status: "done",
  progress: null,
  approval: null,
  view: { kind: "todos", todos },
  error: null,
  result_text: "",
  started_at: 1,
  ended_at: 2,
});

const chat_with = (id: string, todos: Todo[]): Chat => {
  const message: AssistantMessage = {
    id: `${id}-m1`,
    role: "assistant",
    model: "m",
    effort: "",
    mode: "auto",
    plan: false,
    created_at: "2026-10-15T10:00:00.000Z",
    ended_at: "2026-10-15T10:00:05.000Z",
    status: "done",
    steps: [todo_step(todos)],
    reasoning_details: [],
    retry: null,
    error: null,
    context: null,
    last_seq: 0,
  };
  return {
    id,
    title: id,
    project_path: "",
    workspace: "",
    pinned: false,
    created_at: "2026-10-15T10:00:00.000Z",
    updated_at: "2026-10-15T10:00:00.000Z",
    message_count: 1,
    streaming: false,
    summary: null,
    messages: [message],
    questions: {},
  };
};

const todo_cards = () => container.matching((element) => element.className.split(" ").includes("todos-panel"));

const show = (chat_id: string) => client.flushSync(() => root.render(client.createElement(client.ComposerSlot, { chat_id, project_path: "", placement: "docked" })));

before(async () => {
  const dom = install_dom(quiet_vx);
  restore = dom.restore;
  client = await bundle(
    [
      'export { createElement } from "react";',
      'export { flushSync } from "react-dom";',
      'export { createRoot } from "react-dom/client";',
      'export { ComposerSlot } from "./src/features/composer/ComposerSlot.tsx";',
      'export { ComposerTab } from "./src/features/composer/ComposerTab.tsx";',
      'export { chat_view_store } from "./src/state/chat-view.ts";',
      'export { empty_chat_view, begin_load, finish_load } from "./src/state/chat-view-reduce.ts";',
    ],
    [stub_components("ComposerSlot.tsx", Object.fromEntries(stubbed.map((name) => [name, card_stub(name)])))],
  );
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
});

after(() => {
  root?.unmount();
  restore();
});

test("switching away from a chat with open todos and back keeps exactly one todo card", () => {
  let state = client.empty_chat_view;
  for (const [id, todos] of [
    ["a", [todo("1", "done"), todo("2", "in_progress"), todo("3", "pending")]],
    ["b", [todo("1", "pending"), todo("2", "pending"), todo("3", "pending")]],
  ] as const) {
    state = client.finish_load(client.begin_load(state, id), id, chat_with(id, [...todos]));
  }
  client.chat_view_store.set(state);
  for (const chat_id of ["a", "b", "a", "b", "a", "c", "a", "b", "a"]) {
    show(chat_id);
    const cards = todo_cards();
    const expected = chat_id === "c" ? 0 : 1;
    assert.equal(cards.length, expected, `todo cards after switching to ${chat_id}`);
    if (expected === 1) {
      assert.match(cards[0].textContent, chat_id === "a" ? /1\/3/ : /0\/3/);
    }
    const tabs = container.matching((element) => element.getAttribute("data-stub") === "ComposerTab");
    assert.equal(tabs.length, 1, `composer tabs after switching to ${chat_id}`);
    assert.equal(tabs[0].getAttribute("data-chat"), chat_id);
  }
});

test("the dock stack gives every keyed sibling its own key, the queued list in the tab is keyed per chat", () => {
  const keyed = (element: { props: { children: ({ key: string | null } | false)[] } }) =>
    element.props.children.filter((child): child is { key: string } => Boolean(child) && (child as { key: string | null }).key !== null).map((child) => child.key);
  const keys = [...keyed(client.ComposerSlot({ chat_id: "a", project_path: "", placement: "docked" })), ...keyed(client.ComposerTab({ chat_id: "a", project_path: "", draft_key: "a" }))];
  assert.deepEqual(keys, ["todos:a", "queued:a"]);
  assert.equal(new Set(keys).size, keys.length, keys.join(", "));
});
