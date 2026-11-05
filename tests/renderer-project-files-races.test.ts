import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { bundle, install_dom, stub_components, type FakeElement } from "./dom-kit.ts";

let client: any;
let root: any;
let dom: ReturnType<typeof install_dom>;
let release_pick = (_value: unknown) => {};
let release_create = (_value: unknown) => {};
let release_root = (_value: unknown) => {};
let release_restore = () => {};
let delayed_root = false;
let closed = 0;
const calls: { name: string; args: any[] }[] = [];
const value_of = (element: FakeElement): any => (element as any)[Object.keys(element).find((key) => key.startsWith("__reactProps$"))!];
const invoke = async (name: string, ...args: any[]) => {
  calls.push({ name, args });
  if (name === "projects:pick_folder") return new Promise((resolve) => { release_pick = resolve; });
  if (name === "projects:create") return new Promise((resolve) => { release_create = resolve; });
  if (name === "settings:get") return {};
  if (name === "worktrees:restore") return new Promise<void>((resolve) => { release_restore = resolve; });
  if (name === "files:root") {
    if (delayed_root) { delayed_root = false; return new Promise((resolve) => { release_root = resolve; }); }
    return { path: "D:/" + args[0].chat_id, kind: "project", name: "tree", worktree: { branch: "vx/tree", missing: false } };
  }
  if (name === "files:list") return { entries: [], more: 0 };
  if (name === "files:read") return { kind: "text", path: args[1], text: "content", size: 7, truncated: false };
  return undefined;
};
const settle = async () => { for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0)); client.flushSync(() => {}); };
const elements = (name: string) => dom.document.body.matching((element) => element.nodeName === name);
const render = () => client.flushSync(() => root.render(client.createElement(client.CreateProjectDialog, { open: true, on_close: () => { closed++; } })));
before(async () => {
  dom = install_dom({ invoke, on: () => () => {}, send: () => {} });
  client = await bundle([
    'export {createElement} from "react"; export {flushSync} from "react-dom"; export {createRoot} from "react-dom/client";',
    'export {CreateProjectDialog} from "./src/features/sidebar/CreateProjectDialog.tsx";',
    'export {ui_store} from "./src/state/ui.ts";',
    'export {files_store,init_files,sync_files,shown_view,open_file} from "./src/state/files.ts";',
    'export {git_store,set_surface,git_ui_of} from "./src/state/git.ts";',
    'export {show_changed_file} from "./src/state/turn-diff-ui.ts";',
    'export {restore_worktree,worktree_store} from "./src/state/worktree.ts";',
    'export {chats_store} from "./src/state/chats.ts";',
  ], [stub_components("CreateProjectDialog.tsx", { Dialog: 'export const Dialog=({open,children})=>open?children:null;' })]);
  const container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
  client.init_files();
});
after(() => { root?.unmount(); dom.restore(); });
beforeEach(() => {
  client.flushSync(() => root.render(null));
  calls.length = 0; closed = 0; delayed_root = false;
  client.ui_store.set({ ...client.ui_store.get(), active_chat_id: "first", project_path: "D:/project", dock: { kind: null, width: 500, expanded: false } });
  client.files_store.set({ key: "first", views: {} });
  client.git_store.set({ views: {}, ui: {}, readable: null });
  client.worktree_store.set({ choices: {}, eligibility: {}, heads: {}, work: {}, restoring: {}, restore_errors: {} });
  client.chats_store.set({ status: "ready", list: [{ id: "first", project_path: "D:/project" }] });
});

test("unmounting a project dialog rejects both stale picker and stale creation adoption", async () => {
  render();
  client.flushSync(() => value_of(elements("BUTTON").find((element) => element.textContent.includes("Add folder"))!).onClick());
  client.flushSync(() => value_of(elements("INPUT")[0]).onChange({ target: { value: "old project" } }));
  client.flushSync(() => value_of(elements("FORM")[0]).onSubmit({ preventDefault() {} }));
  client.flushSync(() => root.render(null));
  render();
  client.flushSync(() => value_of(elements("INPUT")[0]).onChange({ target: { value: "new session" } }));
  release_pick("D:/old picked folder");
  release_create({ path: "D:/old created project", name: "old" });
  await settle();
  assert.equal(value_of(elements("INPUT")[0]).value, "new session");
  assert.equal(client.ui_store.get().project_path, "D:/project");
  assert.equal(closed, 0);
});

test("an inactive worktree revalidation cannot replace the newly shown chat root", async () => {
  await client.sync_files();
  await client.open_file("old.ts");
  delayed_root = true;
  const refreshing = client.sync_files();
  await settle();
  assert.equal(calls.filter((call) => call.name === "files:root").length, 2);
  client.ui_store.set({ ...client.ui_store.get(), active_chat_id: "second", project_path: "D:/other" });
  await client.sync_files();
  release_root({ path: "D:/first", name: "first", kind: "project", worktree: { branch: "vx/tree", missing: true } });
  await refreshing;
  assert.equal(client.files_store.get().key, "second");
  assert.equal(client.shown_view(client.files_store.get()).root.root.path, "D:/second");
  assert.equal(client.files_store.get().views.first.root.root.worktree.missing, true);
  assert.equal(client.files_store.get().views.first.tabs.length, 0);
});

test("a restore completing after switching docks does not restart a hidden Files watcher", async () => {
  client.ui_store.set({ ...client.ui_store.get(), dock: { kind: "files", width: 500, expanded: false } });
  const restoring = client.restore_worktree("first");
  await settle();
  client.ui_store.set({ ...client.ui_store.get(), dock: { kind: "browser", width: 500, expanded: false } });
  release_restore();
  await restoring;
  assert.equal(calls.some((call) => call.name === "files:watch"), false);
  assert.equal(calls.find((call) => call.name === "files:root")?.args[0].chat_id, "first");
});

test("a changed-file click reveals Files from every different surface and opens the requested file", async () => {
  await client.sync_files();
  for (const surface of ["history", "diff", "changes", "files"]) {
    client.set_surface(surface);
    client.show_changed_file(surface + ".ts");
    await settle();
    assert.equal(client.git_ui_of(client.git_store.get(), "first").surface, "files");
    assert.equal(client.shown_view(client.files_store.get()).active, surface + ".ts");
    assert.equal(client.ui_store.get().dock.kind, "files");
  }
});
