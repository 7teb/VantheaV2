import assert from "node:assert/strict";
import { after, before, test, type TestContext } from "node:test";
import type { ChatMeta } from "../shared/chat.ts";
import { bundle, install_dom, stub_components } from "./dom-kit.ts";

const project = "D:\\Projects\\demo";
const fresh_key = `new:${project}`;
const calls: { name: string; args: unknown[] }[] = [];
const failing = new Map<string, string>();
let created = 0;
let on_init: (chat_id: string) => void = () => {};
let client: any;
let restore = () => {};

const meta = (id: string, project_path: string): ChatMeta => ({
  id,
  title: "",
  project_path,
  workspace: "",
  pinned: false,
  created_at: "2026-10-15T10:00:00.000Z",
  updated_at: "2026-10-15T10:00:00.000Z",
  message_count: 0,
  streaming: false,
});

const invoke = async (name: string, ...args: unknown[]) => {
  calls.push({ name, args });
  const error = failing.get(name);
  if (error) {
    throw new Error(error);
  }
  if (name === "chats:create") {
    created += 1;
    return meta(`created-${created}`, String(args[0]));
  }
  if (name === "turn:init") {
    on_init(String(args[0]));
    return { user_message_id: "u1", message_id: "m1" };
  }
  return undefined;
};

const reports: string[] = [];

const context = (patch: Record<string, unknown> = {}) => ({
  chat_id: null,
  project_path: project,
  draft_key: fresh_key,
  chat: null,
  last_message_id: null,
  busy: false,
  compacting: false,
  plan: false,
  visualize: false,
  usage_percent: null,
  model: null,
  model_context: undefined,
  t: (key: string, vars?: Record<string, string | number>) => client.translate("en", key, vars),
  report: (text: string) => void reports.push(text),
  ...patch,
});

const init_row = (patch: Record<string, unknown> = {}) =>
  client.command_row(
    client.composer_commands.find((command: { id: string }) => command.id === "init"),
    context(patch),
  );

const reset = () => {
  calls.length = 0;
  reports.length = 0;
  failing.clear();
  client.composer_store.set(client.empty_composer);
  client.ui_store.update((state: object) => ({ ...state, active_chat_id: null, project_path: project }));
};

const named = () => calls.map((call) => [call.name, ...call.args]);

before(async () => {
  restore = install_dom({ invoke, on: () => () => {}, send: () => {} }).restore;
  client = await bundle(
    [
      'export { composer_commands, start_typed_review } from "./src/features/composer/command-registry.ts";',
      'export { command_row } from "./src/features/composer/command-menu.ts";',
      'export { composer_store, set_draft_text } from "./src/state/composer.ts";',
      'export { ui_store } from "./src/state/ui.ts";',
      'export { draft_of, empty_composer } from "./src/state/chat-drafts.ts";',
      'export { translate } from "./src/i18n/translate.ts";',
    ],
    [stub_components("command-registry.ts", {})],
  );
});

after(() => restore());

test("Initialize in a fresh project chat creates the chat like the first message does, then starts the init turn there", async () => {
  reset();
  client.set_draft_text(fresh_key, "keep this draft");
  const row = init_row();
  assert.equal(row.disabled, false);
  await row.run();
  assert.deepEqual(named(), [
    ["chats:create", project],
    ["turn:init", "created-1", "init", null],
  ]);
  const ui = client.ui_store.get();
  assert.equal(ui.active_chat_id, "created-1");
  assert.equal(ui.project_path, project);
  const state = client.composer_store.get();
  assert.equal(client.draft_of(state, "created-1").text, "keep this draft");
  assert.equal(client.draft_of(state, fresh_key).text, "");
  assert.equal(state.errors["created-1"] ?? "", "");
  assert.equal(state.sending[fresh_key] ?? false, false);
  assert.deepEqual(reports, []);
});

test("Initialize in an existing project chat starts the init turn in that chat without creating one", async () => {
  reset();
  const row = init_row({ chat_id: "c1", chat: meta("c1", project), draft_key: "c1" });
  assert.equal(row.disabled, false);
  await row.run();
  assert.deepEqual(named(), [["turn:init", "c1", "init", null]]);
});

test("Initialize is disabled with Needs a project for a chat or fresh draft without a project", () => {
  reset();
  for (const patch of [{ project_path: "", draft_key: "new:" }, { chat_id: "c2", chat: meta("c2", ""), project_path: "", draft_key: "c2" }]) {
    const row = init_row(patch);
    assert.equal(row.disabled, true);
    assert.equal(row.hint, "Needs a project");
    assert.equal(row.run, null);
  }
  assert.deepEqual(calls, []);
});

test("a failed chat creation shows its error in the fresh composer and starts no init turn", async (t: TestContext) => {
  reset();
  const logged = t.mock.method(console, "error", () => {});
  failing.set("chats:create", "disk full");
  await init_row().run();
  assert.match(String(logged.mock.calls[0]?.arguments[0]), /^\[composer\] chats:create failed for project /);
  assert.deepEqual(named(), [["chats:create", project]]);
  assert.equal(client.composer_store.get().errors[fresh_key], "disk full");
  assert.equal(client.ui_store.get().active_chat_id, null);
});

test("a failed init turn after the chat was created shows the error in the new chat's composer", async (t: TestContext) => {
  reset();
  const logged = t.mock.method(console, "error", () => {});
  failing.set("turn:init", "no model selected");
  await init_row().run();
  assert.match(String(logged.mock.calls[0]?.arguments[0]), /^\[chat\] turn:init failed for chat created-/);
  const created_id = `created-${created}`;
  assert.deepEqual(named(), [
    ["chats:create", project],
    ["turn:init", created_id, "init", null],
  ]);
  const errors = client.composer_store.get().errors;
  assert.equal(errors[created_id], "Initialize failed: no model selected");
  assert.equal(errors[fresh_key] ?? "", "");
});

test("a second Initialize while the fresh chat is still being created starts nothing", async () => {
  reset();
  const first = init_row().run();
  const second = init_row().run();
  await Promise.all([first, second]);
  assert.deepEqual(
    named().map(([name]) => name),
    ["chats:create", "turn:init"],
  );
});

test("the chat is marked as sending while the init request is on its way and a second Initialize starts nothing", async () => {
  reset();
  const patch = { chat_id: "c3", chat: meta("c3", project), draft_key: "c3" };
  const first = init_row(patch).run();
  assert.equal(client.composer_store.get().sending.c3, true);
  const second = init_row(patch).run();
  await Promise.all([first, second]);
  assert.deepEqual(named(), [["turn:init", "c3", "init", null]]);
  assert.equal(client.composer_store.get().sending.c3 ?? false, false);
});

test("a fresh chat is marked as sending while its init request is on its way", async () => {
  reset();
  const seen: [boolean, boolean][] = [];
  on_init = (chat_id) => {
    const sending = client.composer_store.get().sending;
    seen.push([Boolean(sending[chat_id]), Boolean(sending[fresh_key])]);
  };
  await init_row().run();
  on_init = () => {};
  const created_id = `created-${created}`;
  assert.deepEqual(named(), [
    ["chats:create", project],
    ["turn:init", created_id, "init", null],
  ]);
  assert.deepEqual(seen, [[true, false]]);
  assert.equal(client.composer_store.get().sending[created_id] ?? false, false);
});

const git_init_row = (patch: Record<string, unknown> = {}) =>
  client.command_row(
    client.composer_commands.find((command: { id: string }) => command.id === "git_init"),
    context(patch),
  );

test("Create GitHub repository starts the git_init turn the same way, matches /gitinit and needs a project", async (t: TestContext) => {
  reset();
  const row = git_init_row({ chat_id: "c1", chat: meta("c1", project), draft_key: "c1" });
  assert.equal(row.disabled, false);
  assert.equal(row.label, "Create GitHub repository");
  await row.run();
  assert.deepEqual(named(), [["turn:init", "c1", "git_init", null]]);
  const keywords = client.composer_commands.find((command: { id: string }) => command.id === "git_init").keywords;
  assert.ok(keywords.includes("gitinit"));
  reset();
  assert.equal(git_init_row({ project_path: "", draft_key: "new:" }).disabled, true);
  const logged = t.mock.method(console, "error", () => {});
  failing.set("turn:init", "no model selected");
  await git_init_row({ chat_id: "c1", chat: meta("c1", project), draft_key: "c1" }).run();
  assert.match(String(logged.mock.calls[0]?.arguments[0]), /\(git_init\)$/);
  assert.equal(client.composer_store.get().errors.c1, "Create GitHub repository failed: no model selected");
});

const review_row = (patch: Record<string, unknown> = {}) =>
  client.command_row(
    client.composer_commands.find((command: { id: string }) => command.id === "review"),
    context(patch),
  );

test("Review from the menu starts a review of the current changes, in a fresh project chat after creating it", async () => {
  reset();
  const row = review_row();
  assert.equal(row.disabled, false);
  assert.equal(row.label, "Review");
  assert.equal(row.hint, "Current changes, or /review 123 for a pull request");
  await row.run();
  assert.deepEqual(named(), [
    ["chats:create", project],
    ["turn:init", `created-${created}`, "review", null],
  ]);
  reset();
  const blocked = review_row({ project_path: "", draft_key: "new:" });
  assert.equal(blocked.disabled, true);
  assert.equal(blocked.hint, "Needs a project");
  assert.equal(review_row({ chat_id: "c1", chat: meta("c1", project), draft_key: "c1", compacting: true }).hint, "Compacting");
});

test("a typed /review 42 starts a pull request review with the number and clears the draft", async () => {
  reset();
  client.set_draft_text("c1", "/review 42");
  assert.equal(client.start_typed_review(context({ chat_id: "c1", chat: meta("c1", project), draft_key: "c1" }), 42), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(named(), [["turn:init", "c1", "review", "42"]]);
  assert.equal(client.draft_of(client.composer_store.get(), "c1").text, "");
});

test("a typed review while a turn runs keeps the draft, shows the reason and starts nothing", () => {
  reset();
  client.set_draft_text("c1", "/review #7");
  assert.equal(client.start_typed_review(context({ chat_id: "c1", chat: meta("c1", project), draft_key: "c1", busy: true }), 7), true);
  assert.deepEqual(calls, []);
  assert.deepEqual(reports, ["Turn running"]);
  assert.equal(client.draft_of(client.composer_store.get(), "c1").text, "/review #7");
});

test("a failed pull request review shows the Review error in the chat's composer", async (t: TestContext) => {
  reset();
  const logged = t.mock.method(console, "error", () => {});
  failing.set("turn:init", "invalid argument");
  client.start_typed_review(context({ chat_id: "c1", chat: meta("c1", project), draft_key: "c1" }), 42);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(String(logged.mock.calls[0]?.arguments[0]), /\(review 42\)$/);
  assert.equal(client.composer_store.get().errors.c1, "Review failed: invalid argument");
});
