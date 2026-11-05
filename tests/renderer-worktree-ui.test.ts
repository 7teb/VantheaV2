import assert from "node:assert/strict";
import { after, before, test, type TestContext } from "node:test";
import type { ChatMeta, ChatWorktree } from "../shared/chat.ts";
import { bundle, install_dom, stub_components, type FakeElement } from "./dom-kit.ts";

const project = "D:\\Projects\\demo";
const fresh_key = `new:${project}`;
const calls: { name: string; args: unknown[] }[] = [];
const answers = new Map<string, (...args: unknown[]) => unknown>();
let client: any;
let container: FakeElement;
let root: any;
let restore = () => {};

const tree: ChatWorktree = { path: "C:\\wt\\0a1b2c3d\\demo", prefix: "", branch: "vx/fix-login", base: "c".repeat(40), created_at: "2026-10-26T10:00:00.000Z" };

const meta = (id: string, worktree?: ChatWorktree): ChatMeta => ({
  id,
  title: `Chat ${id}`,
  project_path: project,
  workspace: "",
  pinned: false,
  created_at: "2026-10-26T10:00:00.000Z",
  updated_at: "2026-10-26T10:00:00.000Z",
  message_count: 2,
  streaming: false,
  ...(worktree ? { worktree } : {}),
});

const invoke = async (name: string, ...args: unknown[]) => {
  calls.push({ name, args });
  const answer = answers.get(name);
  return answer ? answer(...args) : undefined;
};

const settled = async () => {
  for (let round = 0; round < 6; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const show = async (element: unknown) => {
  client.flushSync(() => root.render(element));
  await settled();
  client.flushSync(() => {});
};

const press = (element: FakeElement) => {
  const props_key = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
  assert.ok(props_key);
  client.flushSync(() => (element as unknown as Record<string, { onClick: () => void }>)[props_key].onClick());
};

const by_class = (name: string) => container.matching((element) => element.className.split(" ").includes(name));

const row = () => by_class("composer-popover-row")[0];

const hint = () => by_class("composer-popover-hint")[0];

const asked = (name: string) => calls.filter((call) => call.name === name).map((call) => call.args);

const reset = (chats: ChatMeta[] = []) => {
  client.flushSync(() => root.render(null));
  calls.length = 0;
  answers.clear();
  client.worktree_store.set({ choices: {}, eligibility: {}, heads: {}, work: {}, restoring: {}, restore_errors: {} });
  client.chats_store.set({ status: "ready", list: chats });
};

before(async () => {
  const dom = install_dom({ invoke, on: () => () => {}, send: () => {} });
  restore = dom.restore;
  client = await bundle(
    [
      'export { createElement } from "react";',
      'export { flushSync } from "react-dom";',
      'export { createRoot } from "react-dom/client";',
      'export { WorktreeRow } from "./src/features/composer/WorktreeRow.tsx";',
      'export { WorktreeChip } from "./src/features/composer/WorktreeChip.tsx";',
      'export { ComposerStrip } from "./src/features/composer/ComposerStrip.tsx";',
      'export { WorktreeMissing } from "./src/features/docks/files/WorktreeMissing.tsx";',
      'export { WorktreeWarning } from "./src/features/sidebar/WorktreeWarning.tsx";',
      'export { chats_store } from "./src/state/chats.ts";',
      'export { ui_store } from "./src/state/ui.ts";',
      'export { toggle_worktree, worktree_choice, worktree_store } from "./src/state/worktree.ts";',
    ],
    [stub_components("none", {})],
  );
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
});

after(() => {
  root?.unmount();
  restore();
});

const worktree_row = (chat_id: string | null, project_path = project, draft_key = fresh_key) =>
  client.createElement(client.WorktreeRow, { open: true, chat_id, project_path, draft_key, index: 3 });

test("the Worktree row checks the project when the menu opens, shows a skeleton until then and switches the choice", async () => {
  reset();
  let answer: (value: unknown) => void = () => {};
  answers.set("worktrees:eligibility", () => new Promise((resolve) => (answer = resolve)));
  client.flushSync(() => root.render(worktree_row(null)));
  assert.deepEqual(asked("worktrees:eligibility"), [[project]]);
  assert.equal(row().hasAttribute("disabled"), true);
  assert.equal(by_class("skeleton").length, 1);
  answer({ kind: "ready", branch: "main", submodules: false });
  await show(worktree_row(null));
  assert.equal(row().hasAttribute("disabled"), false);
  assert.equal(hint().textContent, "From main");
  assert.equal(row().getAttribute("aria-checked"), "false");
  press(row());
  assert.equal(client.worktree_choice(fresh_key), true);
  assert.equal(row().getAttribute("aria-checked"), "true");
  assert.equal(by_class("toggle")[0].getAttribute("data-checked"), "true");
});

test("the Worktree row is disabled with the reason when the project cannot have a worktree", async () => {
  reset();
  answers.set("worktrees:eligibility", () => ({ kind: "untracked_folder", branch: "main" }));
  await show(worktree_row(null));
  assert.equal(row().hasAttribute("disabled"), true);
  assert.equal(hint().textContent, "Folder is not in the last commit");
});

test("in an existing chat the Worktree row only shows whether that chat works in a worktree", async () => {
  reset([meta("c1", tree), meta("c2")]);
  await show(worktree_row("c1", project, "c1"));
  assert.equal(row().hasAttribute("disabled"), true);
  assert.equal(hint().textContent, "Only when starting a chat");
  assert.equal(row().getAttribute("aria-checked"), "true");
  await show(worktree_row("c2", project, "c2"));
  assert.equal(row().getAttribute("aria-checked"), "false");
  await show(worktree_row(null, "", "new:"));
  assert.equal(hint().textContent, "Needs a project");
  assert.deepEqual(asked("worktrees:eligibility"), []);
});

test("the Worktree chip shows only while the choice is on and a click switches it off", async () => {
  reset();
  const chip = () => container.matching((element) => element.getAttribute("data-kind") === "worktree");
  const element = client.createElement(client.WorktreeChip, { draft_key: fresh_key, project_path: project });
  await show(element);
  assert.equal(chip().length, 0);
  client.flushSync(() => client.toggle_worktree(fresh_key));
  assert.equal(chip().length, 1);
  assert.equal(chip()[0].textContent, "Worktree");
  assert.equal(chip()[0].getAttribute("aria-label"), "Start without a worktree");
  press(chip()[0]);
  assert.equal(client.worktree_choice(fresh_key), false);
  assert.equal(chip().length, 0);
});

const strip = (chat_id: string) => client.createElement(client.ComposerStrip, { chat_id, project_path: project, draft_key: chat_id });

const strip_branch = () => by_class("composer-strip-item")[0];

test("the composer strip shows the live branch of a worktree chat, the project branch otherwise, and turns red when the worktree folder is missing", async () => {
  reset([meta("c1", tree), meta("c2")]);
  answers.set("worktrees:head", () => ({ branch: "vx/renamed", detached_at: null, missing: false }));
  answers.set("worktrees:eligibility", () => ({ kind: "ready", branch: "main", submodules: false }));
  await show(strip("c1"));
  assert.deepEqual(asked("worktrees:head"), [["c1"]]);
  assert.equal(strip_branch().textContent, "vx/renamed");
  assert.equal(strip_branch().getAttribute("data-missing"), null);
  answers.set("worktrees:head", () => ({ branch: null, detached_at: null, missing: true }));
  await show(strip("c2"));
  assert.equal(strip_branch().textContent, "main");
  assert.equal(strip_branch().getAttribute("data-missing"), null);
  await show(strip("c1"));
  assert.equal(strip_branch().textContent, "vx/fix-login");
  assert.equal(strip_branch().getAttribute("data-missing"), "true");
  assert.deepEqual(asked("worktrees:head"), [["c1"], ["c1"]]);
  assert.deepEqual(asked("worktrees:eligibility"), [[project]]);
});

test("the composer strip shows the short commit instead of the creation branch when the worktree HEAD is detached", async () => {
  reset([meta("c1", tree)]);
  answers.set("worktrees:head", () => ({ branch: null, detached_at: "0123456789abcdef0123456789abcdef01234567", missing: false }));
  await show(strip("c1"));
  assert.equal(strip_branch().textContent, "0123456");
  assert.equal(strip_branch().getAttribute("data-missing"), null);
});

test("the composer strip shows the project branch also when the project cannot get a worktree", async () => {
  for (const eligibility of [
    { kind: "programs", keys: ["filter.lfs"], branch: "main" },
    { kind: "untracked_folder", branch: "dev" },
    { kind: "no_commits", branch: "trunk" },
  ]) {
    reset([meta("c2")]);
    answers.set("worktrees:eligibility", () => eligibility);
    await show(strip("c2"));
    assert.equal(strip_branch().textContent, eligibility.branch);
  }
});

test("Restore worktree shows the failure under the button and a success reloads the head and the files root", async (t: TestContext) => {
  reset([meta("c1", tree)]);
  const previous = client.ui_store.get();
  t.after(() => client.ui_store.set(previous));
  client.ui_store.set({ ...previous, active_chat_id: "c1", project_path: project, dock: { ...previous.dock, kind: "files" } });
  const logged = t.mock.method(console, "error", () => {});
  answers.set("worktrees:restore", () => {
    throw new Error("Error invoking remote method 'worktrees:restore': Error: The branch vx/fix-login of this worktree no longer exists, so the worktree cannot be restored");
  });
  await show(client.createElement(client.WorktreeMissing, { chat_id: "c1", path: tree.path }));
  assert.equal(by_class("worktree-missing-path")[0].textContent, tree.path);
  const button = () => by_class("worktree-missing-restore")[0];
  assert.equal(button().textContent, "Restore worktree");
  press(button());
  await show(client.createElement(client.WorktreeMissing, { chat_id: "c1", path: tree.path }));
  assert.match(String(logged.mock.calls[0]?.arguments[0]), /^\[worktree\] worktrees:restore failed for chat c1/);
  assert.equal(by_class("worktree-missing-error")[0].textContent, "Restoring failed: The branch vx/fix-login of this worktree no longer exists, so the worktree cannot be restored");
  assert.equal(button().hasAttribute("disabled"), false);
  answers.set("worktrees:restore", () => meta("c1", tree));
  answers.set("worktrees:head", () => ({ branch: "vx/fix-login", detached_at: null, missing: false }));
  press(button());
  assert.equal(button().textContent, "Restoring worktree");
  assert.equal(button().hasAttribute("disabled"), true);
  await show(client.createElement(client.WorktreeMissing, { chat_id: "c1", path: tree.path }));
  assert.deepEqual(asked("worktrees:restore"), [["c1"], ["c1"]]);
  assert.deepEqual(asked("worktrees:head"), [["c1"]]);
  assert.equal(asked("files:root").length, 1);
  assert.equal(asked("files:watch").length, 1);
  assert.equal(by_class("worktree-missing-error").length, 0);
});

test("a delete confirmation asks main about worktrees only when the target has one, with a skeleton while it reads", async () => {
  reset([meta("c1", tree), meta("c2")]);
  await show(client.createElement(client.WorktreeWarning, { target: { kind: "chats", chat_ids: ["c2"] } }));
  assert.equal(container.textContent, "");
  assert.deepEqual(asked("worktrees:work"), []);
  let answer: (value: unknown) => void = () => {};
  answers.set("worktrees:work", () => new Promise((resolve) => (answer = resolve)));
  const element = client.createElement(client.WorktreeWarning, { target: { kind: "chats", chat_ids: ["c1"] } });
  client.flushSync(() => root.render(element));
  assert.equal(by_class("skeleton").length, 1);
  answer([{ chat_id: "c1", title: "Chat c1", branch: "vx/fix-login", changed: 2, unpushed: 0, missing: false, shared: false }]);
  await show(element);
  const lines = by_class("worktree-warning-line");
  assert.deepEqual(
    lines.map((line) => [line.textContent, line.getAttribute("data-tone")]),
    [
      ["Its worktree folder is deleted. The branch vx/fix-login stays.", "plain"],
      ["The worktree on vx/fix-login has 2 uncommitted changes. They are deleted with the folder.", "warning"],
    ],
  );
  assert.deepEqual(asked("worktrees:work"), [[{ kind: "chats", chat_ids: ["c1"] }]]);
});

test("when main cannot read the worktrees, the warning still names the folders and says the changes were not checked", async (t: TestContext) => {
  reset([meta("c1", tree), meta("c2")]);
  const logged = t.mock.method(console, "error", () => {});
  answers.set("worktrees:work", () => {
    throw new Error("git status failed");
  });
  await show(client.createElement(client.WorktreeWarning, { target: { kind: "project", project_path: project } }));
  assert.match(String(logged.mock.calls[0]?.arguments[0]), /^\[worktree\] worktrees:work failed for /);
  assert.deepEqual(
    by_class("worktree-warning-line").map((line) => line.textContent),
    ["1 worktree folder is deleted. Its branch stays.", "Could not check the worktree for uncommitted changes."],
  );
});
