import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { bundle, install_dom, stub_components, FakeElement } from "./dom-kit.ts";

let client: any;
let root: any;
let container: FakeElement;
let dom: ReturnType<typeof install_dom>;
let active: FakeElement | null = null;
let restore = () => {};
let shown = true;
let closed = 0;
let finish_pick: (value: unknown) => void = () => {};
let finish_create: (value: unknown) => void = () => {};
let fail_create: (error: Error) => void = () => {};
let finish_restore: () => void = () => {};
let missing = false;
let worktree = true;
const calls: { name: string; args: any[] }[] = [];
const invoke = async (name: string, ...args: any[]) => {
  calls.push({ name, args });
  if (name === "projects:pick_folder") return new Promise((resolve) => { finish_pick = resolve; });
  if (name === "projects:create") return new Promise((resolve, reject) => { finish_create = resolve; fail_create = reject; });
  if (name === "settings:get") return {};
  if (name === "worktrees:restore") return new Promise<void>((resolve) => { finish_restore = resolve; });
  if (name === "files:root") return { path: "D:/tree", name: "tree", kind: "project", ...(worktree ? { worktree: { branch: "vx/test", missing } } : {}) };
  if (name === "files:list") return { entries: [], more: 0 };
  if (name === "files:read") return { kind: "text", path: args[1], text: "text", size: 4, truncated: false };
  return undefined;
};
const props = (element: FakeElement): any => (element as any)[Object.keys(element).find((key) => key.startsWith("__reactProps$"))!];
const settle = async () => { for (let index = 0; index < 5; index++) await new Promise((resolve) => setTimeout(resolve, 0)); client.flushSync(() => {}); };
const elements = (tag: string) => dom.document.body.matching((element) => element.nodeName === tag);
const field = () => elements("INPUT")[0];
const render = (open: boolean) => {
  shown = open;
  client.flushSync(() => root.render(client.createElement(client.CreateProjectDialog, { open, on_close: () => { closed++; render(false); } })));
};
before(async () => {
  dom = install_dom({ invoke, on: () => () => {}, send: () => {} });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: FakeElement });
  Object.defineProperty(dom.document, "activeElement", { configurable: true, get: () => active ?? dom.document.body });
  const focus = FakeElement.prototype.focus;
  const descriptors = ["tabIndex", "querySelectorAll"].map((key) => [key, Object.getOwnPropertyDescriptor(FakeElement.prototype, key)] as const);
  FakeElement.prototype.focus = function () { active = this; };
  Object.defineProperty(FakeElement.prototype, "tabIndex", { configurable: true, get() { return this.getAttribute("tabindex") === null ? /^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(this.nodeName) ? 0 : -1 : Number(this.getAttribute("tabindex")); } });
  Object.defineProperty(FakeElement.prototype, "querySelectorAll", { configurable: true, value(this: FakeElement) { return this.matching((element) => /^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(element.nodeName) && !element.hasAttribute("disabled")); } });
  restore = () => {
    FakeElement.prototype.focus = focus;
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(FakeElement.prototype, key, descriptor); else Reflect.deleteProperty(FakeElement.prototype, key); }
    if (previous) Object.defineProperty(globalThis, "HTMLElement", previous); else Reflect.deleteProperty(globalThis, "HTMLElement");
    dom.restore();
  };
  client = await bundle([
    'export {createElement} from "react"; export {flushSync} from "react-dom"; export {createRoot} from "react-dom/client";',
    'export {CreateProjectDialog} from "./src/features/sidebar/CreateProjectDialog.tsx";',
    'export {files_store,init_files,sync_files,shown_view} from "./src/state/files.ts";',
    'export {ui_store,close_dock} from "./src/state/ui.ts";',
    'export {git_store,set_surface,git_ui_of} from "./src/state/git.ts";',
    'export {show_changed_file} from "./src/state/turn-diff-ui.ts";',
    'export {restore_worktree,worktree_store} from "./src/state/worktree.ts";',
    'export {chats_store} from "./src/state/chats.ts";',
  ], [stub_components("none", {})]);
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
  client.init_files();
});
after(() => { root?.unmount(); restore(); });
beforeEach(() => {
  client.flushSync(() => root.render(null));
  calls.length = 0; closed = 0; missing = false; worktree = true;
  client.ui_store.set({ ...client.ui_store.get(), active_chat_id: "chat", project_path: "D:/project", dock: { kind: null, width: 500, expanded: false } });
  client.files_store.set({ key: "chat", views: {} });
  client.git_store.set({ views: {}, ui: {}, readable: null });
  client.worktree_store.set({ choices: {}, eligibility: {}, heads: {}, work: {}, restoring: {}, restore_errors: {} });
  client.chats_store.set({ status: "ready", list: [{ id: "chat", project_path: "D:/project" }] });
});

test("opening the project dialog focuses its name instead of the first close button", () => {
  render(true);
  assert.equal(active?.nodeName, "INPUT");
});

test("a folder picker response after close cannot populate a reopened dialog", async () => {
  render(true);
  const picker = elements("BUTTON").find((element) => element.textContent.includes("Add folder"))!;
  assert.ok(picker);
  client.flushSync(() => props(picker).onClick());
  render(false);
  render(true);
  finish_pick("D:/stale-folder");
  await settle();
  assert.equal(props(field()).value, "");
  assert.equal(dom.document.body.textContent.includes("D:/stale-folder"), false);
});

test("a project creation completed after close cannot navigate or close a newer dialog", async () => {
  render(true);
  client.flushSync(() => props(field()).onChange({ target: { value: "old project" } }));
  client.flushSync(() => props(elements("FORM")[0]).onSubmit({ preventDefault() {} }));
  render(false);
  render(true);
  client.flushSync(() => props(field()).onChange({ target: { value: "new draft" } }));
  finish_create({ path: "D:/old-project", name: "old project" });
  await settle();
  assert.equal(client.ui_store.get().project_path, "D:/project");
  assert.equal(shown, true);
  assert.equal(props(field()).value, "new draft");
  assert.equal(closed, 0);
});

test("reentering Files detects an externally deleted cached worktree root", async () => {
  await client.sync_files();
  missing = true;
  await client.sync_files();
  assert.equal(client.shown_view(client.files_store.get()).root.root.worktree.missing, true);
});

test("opening a changed file from history selects the Files surface", async () => {
  await client.sync_files();
  client.set_surface("history");
  client.show_changed_file("a.ts");
  await settle();
  assert.equal(client.git_ui_of(client.git_store.get(), "chat").surface, "files");
  assert.equal(client.shown_view(client.files_store.get()).active, "a.ts");
});

test("restoring while Files was closed never creates a watcher or Git session", async () => {
  const pending = client.restore_worktree("chat");
  await settle();
  finish_restore();
  await pending;
  assert.equal(calls.some((call) => call.name === "files:watch"), false);
});

test("closing Files while restore waits prevents its late watcher", async () => {
  client.ui_store.set({ ...client.ui_store.get(), dock: { kind: "files", width: 500, expanded: false } });
  const pending = client.restore_worktree("chat");
  await settle();
  client.close_dock();
  finish_restore();
  await pending;
  assert.equal(calls.some((call) => call.name === "files:watch"), false);
});

test("current folder choice fills the name and reopening focuses it again", async () => {
  render(true);
  const picker = elements("BUTTON").find((element) => element.textContent.includes("Add folder"))!;
  client.flushSync(() => props(picker).onClick());
  finish_pick("D:/chosen-folder");
  await settle();
  assert.equal(props(field()).value, "chosen-folder");
  render(false);
  render(true);
  assert.equal(active === field(), true, "reopened project dialog should focus the name input");
});

test("current successful creation selects the created project and closes only its own dialog", async () => {
  render(true);
  client.flushSync(() => props(field()).onChange({ target: { value: "created" } }));
  client.flushSync(() => props(elements("FORM")[0]).onSubmit({ preventDefault() {} }));
  finish_create({ path: "D:/created", name: "created" });
  await settle();
  assert.equal(client.ui_store.get().project_path, "D:/created");
  assert.equal(closed, 1);
  assert.equal(shown, false);
});

test("a stale creation failure cannot replace the new dialog's draft or show an old error", async () => {
  render(true);
  client.flushSync(() => props(field()).onChange({ target: { value: "old" } }));
  client.flushSync(() => props(elements("FORM")[0]).onSubmit({ preventDefault() {} }));
  render(false);
  render(true);
  client.flushSync(() => props(field()).onChange({ target: { value: "new" } }));
  fail_create(new Error("old failure"));
  await settle();
  assert.equal(props(field()).value, "new");
  assert.equal(dom.document.body.textContent.includes("old failure"), false);
});

test("ordinary project roots remain cached while unchanged worktree tabs remain open", async () => {
  worktree = false;
  await client.sync_files();
  await client.sync_files();
  assert.equal(calls.filter((call) => call.name === "files:root").length, 1);
  worktree = true;
  client.files_store.set({ key: "chat", views: {} });
  await client.sync_files();
  client.show_changed_file("kept.ts");
  await settle();
  await client.sync_files();
  assert.equal(client.shown_view(client.files_store.get()).active, "kept.ts");
  assert.equal(client.shown_view(client.files_store.get()).tabs.length, 1);
});

test("an active open Files dock still watches the restored worktree exactly once", async () => {
  client.ui_store.set({ ...client.ui_store.get(), dock: { kind: "files", width: 500, expanded: false } });
  const pending = client.restore_worktree("chat");
  await client.restore_worktree("chat");
  finish_restore();
  await pending;
  assert.equal(calls.filter((call) => call.name === "files:watch").length, 1);
  assert.equal(calls.filter((call) => call.name === "worktrees:restore").length, 1);
});
