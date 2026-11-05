import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { DirListing, FileView, FilesRoot, FilesScope } from "../shared/ipc/files.ts";
import { bundle, install_dom, stub_components, type FakeElement, type Vx } from "./dom-kit.ts";

const calls: { name: string; args: unknown[] }[] = [];
const listeners = new Map<string, (payload: unknown) => void>();
const disk = { files: ["a.ts"], text: "v1" };
const held: { name: string; release: () => void }[] = [];
let hold: string | null = null;
let root: FilesRoot = { path: "D:/project", name: "project", kind: "project" };
let client: any;
let container: FakeElement;
let dock: any;
let restore = () => {};

const listing = (dir: string): DirListing => ({
  path: dir,
  entries: disk.files.map((name) => ({ name, path: name, kind: "file" })),
  more: 0,
});

const answer = (name: string, args: unknown[]) => {
  if (name === "files:root") {
    const scope = args[0] as FilesScope;
    return scope.chat_id === null && !scope.project_path ? null : root;
  }
  if (name === "files:list") return listing(args[1] as string);
  if (name === "files:read") return { kind: "text", path: args[1] as string, size: disk.text.length, text: disk.text, truncated: false } satisfies FileView;
  if (name === "files:find") return { paths: disk.files.filter((file) => file.includes(args[1] as string)), truncated: false };
  return undefined;
};

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const view_of = (key: string) => client.files_store.get().views[key];

const shown = () => client.shown_view(client.files_store.get());

const tab_text = (view: { tabs: { path: string; view: { text: string } | null }[] } | undefined, file: string) =>
  view?.tabs.find((tab) => tab.path === file)?.view?.text;

const show_chat = (chat_id: string | null, project_path: string) =>
  client.ui_store.update((state: object) => ({ ...state, active_chat_id: chat_id, project_path }));

const vx: Vx = {
  invoke: async (name, ...args) => {
    calls.push({ name, args });
    if (hold === name) {
      hold = null;
      await new Promise<void>((resolve) => held.push({ name, release: resolve }));
    }
    return answer(name, args);
  },
  on: (name, listener) => {
    listeners.set(name, listener);
    return () => {
      listeners.delete(name);
    };
  },
  send: () => undefined,
};

const part_stub = (name: string) => `import { createElement } from "react"; export const ${name} = () => createElement("div", { "data-stub": "${name}" });`;

before(async () => {
  const dom = install_dom(vx);
  restore = dom.restore;
  client = await bundle(
    [
      'export { createElement } from "react";',
      'export { flushSync } from "react-dom";',
      'export { createRoot } from "react-dom/client";',
      'export { adopt_files, files_store, init_files, open_file, reload_files_root, set_query, shown_view, sync_files } from "./src/state/files.ts";',
      'export { ui_store } from "./src/state/ui.ts";',
      'export { FilesDock } from "./src/features/docks/files/FilesDock.tsx";',
    ],
    [stub_components("FilesDock.tsx", { FileTree: part_stub("FileTree"), FileViewer: part_stub("FileViewer"), GitCard: part_stub("GitCard") })],
  );
  client.init_files();
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  dock = client.createRoot(container);
});

beforeEach(() => {
  calls.length = 0;
});

after(() => {
  restore();
});

test("each chat keeps its own open tabs and filter, switching back reloads them instead of sharing", async () => {
  show_chat("c1", "D:/project");
  await client.sync_files();
  await settled();
  await client.open_file("a.ts");
  client.set_query("a");
  assert.equal(tab_text(shown(), "a.ts"), "v1");

  calls.length = 0;
  show_chat("c2", "D:/project");
  assert.equal(client.files_store.get().key, "c2");
  assert.deepEqual(shown().tabs, []);
  assert.equal(shown().query, "");
  await client.sync_files();
  await settled();
  assert.deepEqual(shown().tabs, []);
  assert.deepEqual(shown().dirs[""].entries.map((entry: { path: string }) => entry.path), ["a.ts"]);
  assert.deepEqual(calls.find((call) => call.name === "files:root")?.args[0] as FilesScope, { chat_id: "c2", project_path: "D:/project" });

  disk.text = "v2";
  show_chat("c1", "D:/project");
  assert.equal(shown().query, "a");
  assert.equal(tab_text(shown(), "a.ts"), "v1");
  calls.length = 0;
  await client.sync_files();
  await settled();
  assert.equal(calls.filter((call) => call.name === "files:root").length, 0);
  assert.equal(tab_text(shown(), "a.ts"), "v2");
  assert.ok(calls.some((call) => call.name === "files:find" && (call.args[0] as FilesScope).chat_id === "c1"));
});

test("a read that finishes after the user switched chats lands in the chat that started it", async () => {
  show_chat("c1", "D:/project");
  disk.text = "v3";
  hold = "files:read";
  const opening = client.open_file("b.ts");
  await settled();
  show_chat("c2", "D:/project");
  held.shift()?.release();
  await opening;
  assert.equal(tab_text(view_of("c1"), "b.ts"), "v3");
  assert.equal(view_of("c1").active, "b.ts");
  assert.deepEqual(view_of("c2").tabs, []);
});

test("a watcher change reloads only the shown chat's view", async () => {
  show_chat("c2", "D:/project");
  await client.open_file("a.ts");
  calls.length = 0;
  listeners.get("files:changed")?.({ root: "D:/project", paths: ["a.ts"], overflow: false });
  await settled();
  const scopes = calls.filter((call) => call.name === "files:read").map((call) => (call.args[0] as FilesScope).chat_id);
  assert.deepEqual(scopes, ["c2"]);
});

test("a chat created from the new-chat screen keeps the tree and tabs opened there", async () => {
  show_chat(null, "D:/project");
  await client.sync_files();
  await settled();
  await client.open_file("a.ts");
  assert.ok(view_of("new:D:/project"));

  client.adopt_files("new:D:/project", "c9");
  show_chat("c9", "D:/project");
  assert.equal(view_of("new:D:/project"), undefined);
  assert.deepEqual(shown().tabs.map((tab: { path: string }) => tab.path), ["a.ts"]);
  assert.deepEqual(shown().scope, { chat_id: "c9", project_path: "D:/project" });
  calls.length = 0;
  await client.sync_files();
  await settled();
  assert.equal(calls.filter((call) => call.name === "files:root").length, 0);
  assert.deepEqual(shown().tabs.map((tab: { path: string }) => tab.path), ["a.ts"]);
  assert.ok(calls.length > 0);
  assert.ok(calls.every((call) => (call.args[0] as FilesScope).chat_id === "c9"));
});

test("deleting a chat drops its files view and ignores results still in flight for it", async () => {
  show_chat("c1", "D:/project");
  hold = "files:read";
  const opening = client.open_file("late.ts");
  await settled();
  listeners.get("chats:removed")?.({ chat_id: "c1" });
  held.shift()?.release();
  await opening;
  assert.equal(view_of("c1"), undefined);
  assert.ok(view_of("c2"));
});

test("a chat whose folder moved starts a fresh tree without the old tabs", async () => {
  root = { path: "D:/other", name: "other", kind: "project" };
  show_chat("c2", "D:/other");
  await client.sync_files();
  await settled();
  assert.equal(calls.filter((call) => call.name === "files:list").length, 1);
  assert.equal(calls.filter((call) => call.name === "files:read").length, 0);
  assert.deepEqual(shown().tabs, []);
  assert.equal(shown().root.root.path, "D:/other");
});

test("a chat created from the new-chat screen without a project shows its workspace folder", async () => {
  show_chat(null, "");
  await client.sync_files();
  await settled();
  assert.equal(shown().root.status, "none");

  root = { path: "C:/workspaces/c10", name: "c10", kind: "workspace" };
  client.adopt_files("new:", "c10");
  show_chat("c10", "");
  assert.equal(view_of("new:"), undefined);
  calls.length = 0;
  await client.sync_files();
  await settled();
  assert.deepEqual(calls.filter((call) => call.name === "files:root").map((call) => call.args[0] as FilesScope), [{ chat_id: "c10", project_path: "" }]);
  assert.equal(shown().root.status, "ready");
  assert.equal(shown().root.root.path, "C:/workspaces/c10");
  assert.deepEqual(shown().dirs[""].entries.map((entry: { path: string }) => entry.path), ["a.ts"]);

  show_chat("c2", "D:/other");
  show_chat("c10", "");
  calls.length = 0;
  await client.sync_files();
  await settled();
  assert.equal(calls.filter((call) => call.name === "files:root").length, 0);
  assert.equal(shown().root.root.path, "C:/workspaces/c10");
});

test("switching chats with the panel open only re-sends files:watch, hiding or closing the panel sends files:unwatch", async () => {
  root = { path: "D:/project", name: "project", kind: "project" };
  const show_dock = (visible: boolean, chat_id: string) =>
    client.flushSync(() => dock.render(client.createElement(client.FilesDock, { visible, chat_id, project_path: "D:/project" })));
  const sent = () => calls.filter((call) => call.name === "files:watch" || call.name === "files:unwatch").map((call) => call.name);

  show_chat("c1", "D:/project");
  show_dock(true, "c1");
  await settled();
  assert.deepEqual(sent(), ["files:watch"]);

  calls.length = 0;
  show_chat("c2", "D:/project");
  show_dock(true, "c2");
  await settled();
  assert.deepEqual(sent(), ["files:watch"]);
  assert.deepEqual(calls.find((call) => call.name === "files:watch")?.args[0] as FilesScope, { chat_id: "c2", project_path: "D:/project" });

  calls.length = 0;
  show_dock(false, "c2");
  await settled();
  assert.deepEqual(sent(), ["files:unwatch"]);

  calls.length = 0;
  show_dock(true, "c2");
  await settled();
  assert.deepEqual(sent(), ["files:watch"]);

  calls.length = 0;
  dock.unmount();
  await settled();
  assert.deepEqual(sent(), ["files:unwatch"]);
});

test("a missing worktree root lists no folder and shows the restore notice, and the restored root loads its tree", async () => {
  const project_root = root;
  const host = container.ownerDocument!.createElement("div");
  container.ownerDocument!.body.appendChild(host);
  const own = client.createRoot(host);
  const render = () => client.flushSync(() => own.render(client.createElement(client.FilesDock, { visible: true, chat_id: "w1", project_path: "D:/project" })));
  const notices = () => host.matching((element) => element.className === "worktree-missing").length;
  root = { path: "C:/wt/0a1b2c3d/project", name: "project", kind: "project", worktree: { branch: "vx/a", missing: true } };
  show_chat("w1", "D:/project");
  render();
  await settled();
  await settled();
  render();
  assert.equal(calls.filter((call) => call.name === "files:list").length, 0);
  assert.equal(notices(), 1);
  assert.equal(host.matching((element) => element.getAttribute("data-stub") === "GitCard").length, 0);

  root = { ...root, worktree: { branch: "vx/a", missing: false } };
  calls.length = 0;
  await client.reload_files_root();
  await settled();
  render();
  assert.deepEqual(calls.filter((call) => call.name === "files:list").map((call) => call.args[1]), [""]);
  assert.equal(notices(), 0);
  assert.equal(host.matching((element) => element.getAttribute("data-stub") === "FileTree").length, 1);
  own.unmount();
  root = project_root;
});
