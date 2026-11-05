import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { bundle, install_dom, stub_components, type FakeElement } from "./dom-kit.ts";

let client: any;
let container: FakeElement;
let root: any;
let restore = () => {};
let saved = "saved instructions";
let reject_save: ((error: Error) => void) | null = null;
let resolve_save: ((value: unknown) => void) | null = null;
let finish_restore: (() => void) | null = null;
let fail_reload = false;
const calls: { name: string; args: any[] }[] = [];
const view = () => ({ custom_instructions: saved, personality: "pragmatic", memory: { enabled: true, exclude_tool_chats: false }, model_context: {} });
const invoke = async (name: string, ...args: any[]) => {
  calls.push({ name, args });
  if (name === "settings:get") {
    if (fail_reload) throw new Error("reload failed");
    return view();
  }
  if (name === "settings:update") return new Promise((resolve, reject) => { resolve_save = resolve; reject_save = reject; });
  if (name === "worktrees:restore") return new Promise<void>((resolve) => { finish_restore = resolve; });
  if (name === "files:root") return { path: `C:/trees/${args[0].chat_id}`, name: "project", kind: "project" };
  if (name === "files:list") return { entries: [], more: 0 };
  return undefined;
};
const settle = async () => { for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0)); client.flushSync(() => {}); };
const matching = (name: string) => container.matching((node) => node.className.split(" ").includes(name));
const props = (element: FakeElement): any => (element as any)[Object.keys(element).find((key) => key.startsWith("__reactProps$"))!];
const input = () => matching("instructions-input")[0];
const button = () => matching("instructions-footer")[0].matching((node) => node.nodeName === "BUTTON")[0];
const type = (value: string) => client.flushSync(() => props(input()).onChange({ target: { value } }));
const save = () => client.flushSync(() => props(button()).onClick());

before(async () => {
  const dom = install_dom({ invoke, on: () => () => {}, send: () => {} });
  restore = dom.restore;
  client = await bundle([
    'export {createElement} from "react";',
    'export {flushSync} from "react-dom";',
    'export {createRoot} from "react-dom/client";',
    'export {PersonalizationPane} from "./src/features/settings/panes/PersonalizationPane.tsx";',
    'export {settings_store} from "./src/state/settings.ts";',
    'export {restore_worktree,worktree_store} from "./src/state/worktree.ts";',
    'export {files_store} from "./src/state/files.ts";',
    'export {chats_store} from "./src/state/chats.ts";',
    'export {ui_store} from "./src/state/ui.ts";',
  ], [stub_components("PersonalizationPane.tsx", { MemoryLists: 'export const MemoryLists=()=>null;' })]);
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
});
after(() => { root?.unmount(); restore(); });
beforeEach(() => {
  client.flushSync(() => root.render(null));
  saved = "saved instructions";
  calls.length = 0;
  reject_save = null;
  resolve_save = null;
  finish_restore = null;
  fail_reload = false;
  client.settings_store.set(view());
  client.worktree_store.set({ choices: {}, eligibility: {}, heads: {}, work: {}, restoring: {}, restore_errors: {} });
  client.files_store.set({ key: "other", views: {} });
  client.chats_store.set({ status: "ready", list: [{ id: "restored", project_path: "D:/restored" }, { id: "other", project_path: "D:/other" }] });
  client.ui_store.set({ ...client.ui_store.get(), active_chat_id: "other", project_path: "D:/other" });
});
const show = () => client.flushSync(() => root.render(client.createElement(client.PersonalizationPane)));

test("failed instructions save preserves the entered text after optimistic rollback", async () => {
  show();
  type("my unsaved instructions");
  save();
  await settle();
  assert.ok(reject_save);
  reject_save(new Error("disk full"));
  await settle();
  assert.equal(props(input()).value, "my unsaved instructions");
  assert.equal(props(button()).disabled, false);
});

test("instructions typed while a save is pending survive its failure", async () => {
  show();
  type("first edit");
  save();
  await settle();
  type("newer edit");
  reject_save!(new Error("disk full"));
  await settle();
  assert.equal(props(input()).value, "newer edit");
});

test("successful instructions save keeps the submitted text and disables its save button", async () => {
  show();
  type("accepted edit");
  save();
  await settle();
  saved = "accepted edit";
  resolve_save!(view());
  await settle();
  assert.equal(props(input()).value, saved);
  assert.equal(props(button()).disabled, true);
});

test("a rejected save remains retryable even when refreshing the saved settings also fails", async () => {
  show();
  type("retryable edit");
  save();
  await settle();
  fail_reload = true;
  reject_save!(new Error("disk full"));
  await settle();
  assert.equal(props(input()).value, "retryable edit");
  assert.equal(props(button()).disabled, false);
  save();
  await settle();
  assert.equal(calls.filter((entry) => entry.name === "settings:update").length, 2);
  saved = "retryable edit";
  resolve_save!(view());
  await settle();
});

test("editing during an outstanding save does not enable a duplicate save", async () => {
  show();
  type("first edit");
  save();
  await settle();
  type("second edit");
  assert.equal(props(button()).disabled, true);
  saved = "first edit";
  resolve_save!(view());
  await settle();
  assert.equal(props(input()).value, "second edit");
  assert.equal(props(button()).disabled, false);
});

test("restoring an inactive worktree reloads its own Files root and leaves the active watcher alone", async () => {
  const pending = client.restore_worktree("restored");
  await settle();
  finish_restore!();
  await pending;
  assert.deepEqual(calls.filter((entry) => entry.name === "files:root").map((entry) => entry.args[0]), [{ chat_id: "restored", project_path: "D:/restored" }]);
  assert.equal(calls.some((entry) => entry.name === "files:watch"), false);
  assert.equal(client.files_store.get().key, "other");
});

test("switching away while restore waits cannot reload the newly selected chat", async () => {
  client.ui_store.set({ ...client.ui_store.get(), active_chat_id: "restored", project_path: "D:/restored" });
  const pending = client.restore_worktree("restored");
  await settle();
  client.ui_store.set({ ...client.ui_store.get(), active_chat_id: "other", project_path: "D:/other" });
  finish_restore!();
  await pending;
  assert.equal(calls.find((entry) => entry.name === "files:root")?.args[0].chat_id, "restored");
  assert.equal(calls.some((entry) => entry.name === "files:watch"), false);
});

test("a restored worktree which stays active refreshes its watch and suppresses duplicate restores", async () => {
  client.ui_store.set({ ...client.ui_store.get(), active_chat_id: "restored", project_path: "D:/restored", dock: { ...client.ui_store.get().dock, kind: "files" } });
  const pending = client.restore_worktree("restored");
  await client.restore_worktree("restored");
  finish_restore!();
  await pending;
  assert.equal(calls.filter((entry) => entry.name === "worktrees:restore").length, 1);
  assert.equal(calls.find((entry) => entry.name === "files:watch")?.args[0].chat_id, "restored");
});
