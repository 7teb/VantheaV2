import assert from "node:assert/strict";
import { after, before, test, type TestContext } from "node:test";
import type { ChatMeta, ChatWorktree } from "../shared/chat.ts";
import { bundle, install_dom, stub_components } from "./dom-kit.ts";

const project = "D:\\Projects\\demo";
const fresh_key = `new:${project}`;
const calls: { name: string; args: unknown[] }[] = [];
const failing = new Map<string, string>();
let created = 0;
let client: any;
let restore = () => {};

const tree: ChatWorktree = { path: "C:\\wt\\0a1b2c3d\\demo", prefix: "", branch: "vx/fix-the-login", base: "b".repeat(40), created_at: "2026-10-26T10:00:00.000Z" };

const meta = (id: string, worktree?: ChatWorktree): ChatMeta => ({
  id,
  title: "",
  project_path: project,
  workspace: "",
  pinned: false,
  created_at: "2026-10-26T10:00:00.000Z",
  updated_at: "2026-10-26T10:00:00.000Z",
  message_count: 0,
  streaming: false,
  ...(worktree ? { worktree } : {}),
});

const invoke = async (name: string, ...args: unknown[]) => {
  calls.push({ name, args });
  const error = failing.get(name);
  if (error) {
    throw new Error(error);
  }
  if (name === "chats:create") {
    created += 1;
    return meta(`plain-${created}`);
  }
  if (name === "worktrees:create_chat") {
    created += 1;
    return meta(`tree-${created}`, tree);
  }
  if (name === "turn:init") {
    return { user_message_id: "u1", message_id: "m1" };
  }
  return undefined;
};

const named = () => calls.map((call) => [call.name, ...call.args]);

const terminal_tab = { id: "t1", chat_id: null, project_path: project, status: "running", exit_code: null, error: "" };

const reset = () => {
  calls.length = 0;
  failing.clear();
  client.composer_store.set(client.empty_composer);
  client.worktree_store.update((state: object) => ({ ...state, choices: {} }));
  client.terminal_store.set({ groups: { [fresh_key]: { tabs: [terminal_tab], active_id: "t1" } } });
  client.ui_store.update((state: object) => ({ ...state, active_chat_id: null, project_path: project }));
};

const terminal_keys = () => Object.keys(client.terminal_store.get().groups);

before(async () => {
  restore = install_dom({ invoke, on: () => () => {}, send: () => {} }).restore;
  client = await bundle(
    [
      'export { composer_store, set_draft_text, submit } from "./src/state/composer.ts";',
      'export { start_command_turn } from "./src/state/chat-create.ts";',
      'export { draft_of, empty_composer } from "./src/state/chat-drafts.ts";',
      'export { terminal_store } from "./src/state/terminal.ts";',
      'export { ui_store } from "./src/state/ui.ts";',
      'export { toggle_worktree, worktree_choice, worktree_store } from "./src/state/worktree.ts";',
    ],
    [stub_components("none", {})],
  );
});

after(() => restore());

test("sending the first message with Worktree on creates a worktree chat seeded with that message and keeps new-chat terminals behind", async (t: TestContext) => {
  reset();
  t.mock.method(console, "error", () => {});
  client.toggle_worktree(fresh_key);
  client.set_draft_text(fresh_key, "fix the login bug");
  await client.submit(null, project);
  assert.deepEqual(named()[0], ["worktrees:create_chat", project, "fix the login bug"]);
  assert.equal(calls.some((call) => call.name === "chats:create"), false);
  const chat_id = `tree-${created}`;
  assert.equal(client.ui_store.get().active_chat_id, chat_id);
  assert.deepEqual(terminal_keys(), [fresh_key]);
  assert.equal(client.worktree_choice(fresh_key), false);
});

test("without the Worktree choice the chat is created as before and new-chat terminals move into it", async (t: TestContext) => {
  reset();
  t.mock.method(console, "error", () => {});
  client.set_draft_text(fresh_key, "hello");
  await client.submit(null, project);
  assert.deepEqual(named()[0], ["chats:create", project]);
  assert.deepEqual(terminal_keys(), [`plain-${created}`]);
});

test("Initialize in a fresh chat with Worktree on creates the worktree chat with an empty seed, then starts the init turn there", async () => {
  reset();
  client.toggle_worktree(fresh_key);
  await client.start_command_turn(null, project, "init");
  assert.deepEqual(named(), [
    ["worktrees:create_chat", project, ""],
    ["turn:init", `tree-${created}`, "init", null],
  ]);
  assert.equal(client.worktree_choice(fresh_key), false);
});

test("reviewing current changes in a fresh chat ignores the Worktree switch, a pull request review respects it", async () => {
  reset();
  client.toggle_worktree(fresh_key);
  await client.start_command_turn(null, project, "review");
  assert.deepEqual(named()[0], ["chats:create", project]);
  assert.equal(named().some(([name]) => name === "worktrees:create_chat"), false);
  reset();
  client.toggle_worktree(fresh_key);
  await client.start_command_turn(null, project, "review", "42");
  assert.deepEqual(named()[0], ["worktrees:create_chat", project, ""]);
});

test("a failed worktree creation keeps the text, the choice and the new-chat terminals and shows the error", async (t: TestContext) => {
  reset();
  const logged = t.mock.method(console, "error", () => {});
  failing.set("worktrees:create_chat", 'worktree step "add worktree" failed: fatal: invalid reference');
  client.toggle_worktree(fresh_key);
  client.set_draft_text(fresh_key, "keep me");
  await client.submit(null, project);
  assert.match(String(logged.mock.calls[0]?.arguments[0]), /^\[composer\] worktrees:create_chat failed for project /);
  assert.deepEqual(named(), [["worktrees:create_chat", project, "keep me"]]);
  const state = client.composer_store.get();
  assert.equal(client.draft_of(state, fresh_key).text, "keep me");
  assert.match(state.errors[fresh_key], /invalid reference/);
  assert.equal(state.sending[fresh_key] ?? false, false);
  assert.equal(client.worktree_choice(fresh_key), true);
  assert.deepEqual(terminal_keys(), [fresh_key]);
  assert.equal(client.ui_store.get().active_chat_id, null);
});

test("the Worktree choice belongs to one new-chat draft: another project's new chat is created without a worktree", async (t: TestContext) => {
  reset();
  t.mock.method(console, "error", () => {});
  client.toggle_worktree(fresh_key);
  const other = "D:\\Projects\\other";
  client.set_draft_text(`new:${other}`, "elsewhere");
  await client.submit(null, other);
  assert.deepEqual(named()[0], ["chats:create", other]);
  assert.equal(client.worktree_choice(fresh_key), true);
});
