import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { GitView, GraphRow, HistoryPage, HistoryRequest } from "../shared/git-view.ts";
import type { FilesScope } from "../shared/ipc/files.ts";
import { empty_lanes, lay_out } from "../shared/git/graph.ts";
import { bundle, FakeElement, install_dom, stub_components, type Vx } from "./dom-kit.ts";
import { repo } from "./git-view-kit.ts";

type Listener = (event: unknown) => void;

const calls: { name: string; args: unknown[] }[] = [];
const listeners = new Map<string, (payload: any) => void>();
const element_listeners = new WeakMap<object, Map<string, Set<Listener>>>();

const hash_of = (letter: string, index: number) => `${letter}${String(index).padStart(39, "0")}`;

const history_rows = (letter: string, count: number): GraphRow[] =>
  lay_out(
    Array.from({ length: count }, (_value, index) => ({
      hash: hash_of(letter, index),
      parents: index + 1 < count ? [hash_of(letter, index + 1)] : [],
      author: "VantheaX Test",
      time: 1_700_000_000_000 - index * 60_000,
      subject: `${letter} commit ${index}`,
    })),
    empty_lanes,
  ).rows.map((row) => ({ ...row, labels: [] }));

const repos: Record<string, { fingerprint: string; rows: GraphRow[] }> = {};

const held: { release: () => void; fail: (error: Error) => void }[] = [];

const main = { bound: "", hold_call: 0, history_calls: 0 };

const page_for = (project: string, request: HistoryRequest): HistoryPage => {
  const served = repos[project];
  const start = request.fingerprint === served.fingerprint ? request.offset : 0;
  const rows = served.rows.slice(start, start + 200);
  return { fingerprint: served.fingerprint, start, rows, done: start + rows.length >= served.rows.length, shallow_end: false };
};

const answer_history = (scope: FilesScope, request: HistoryRequest): HistoryPage => {
  if (scope.project_path !== main.bound) {
    throw new Error("git session is bound to another folder");
  }
  return page_for(scope.project_path, request);
};

const vx: Vx = {
  invoke: async (name, ...args) => {
    calls.push({ name, args });
    const scope = args[0] as FilesScope;
    if (name === "files:root") return { path: scope.project_path, name: "project", kind: "project" };
    if (name === "files:list") return { path: "", entries: [], more: 0 };
    if (name === "git:history") {
      main.history_calls += 1;
      const page = answer_history(scope, args[1] as HistoryRequest);
      if (main.history_calls !== main.hold_call) return page;
      return new Promise((resolve, reject) => held.push({ release: () => resolve(page), fail: reject }));
    }
    if (name === "git:commit") return new Promise(() => {});
    return undefined;
  },
  on: (name, listener) => {
    listeners.set(name, listener);
    return () => {
      listeners.delete(name);
    };
  },
  send: () => {},
};

const geometry = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };

Object.assign(FakeElement.prototype, {
  scrollTop: 0,
  clientHeight: 0,
  scrollHeight: 0,
  getBoundingClientRect: () => geometry,
  addEventListener(this: object, type: string, listener: Listener) {
    const by_type = element_listeners.get(this) ?? new Map<string, Set<Listener>>();
    element_listeners.set(this, by_type);
    by_type.set(type, (by_type.get(type) ?? new Set<Listener>()).add(listener));
  },
  removeEventListener(this: object, type: string, listener: Listener) {
    element_listeners.get(this)?.get(type)?.delete(listener);
  },
});

const fire = (element: FakeElement, type: string) => {
  for (const listener of element_listeners.get(element)?.get(type) ?? []) listener({ type, target: element });
};

let client: any;
let container: FakeElement;
let root: any;
let restore = () => {};

const settled = async () => {
  for (let round = 0; round < 6; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const emit_view = (project: string, view: GitView) => listeners.get("git:changed")?.({ root: project, view });

const shown = (project: string) => repo({ fingerprint: repos[project].fingerprint, head: repos[project].rows[0].hash });

const switch_chat = async (chat_id: string, project: string) => {
  client.flushSync(() => client.open_chat(chat_id, project));
  await client.sync_files();
  await settled();
  main.bound = project;
};

const history_scopes = () => calls.filter((call) => call.name === "git:history").map((call) => (call.args[0] as FilesScope).project_path);

const list_of = (project: string) => client.history_of(client.git_history_store.get(), project);

const set_list = (project: string, fingerprint: string, rows: GraphRow[], done: boolean) =>
  client.git_history_store.update((state: any) => ({ ...state, lists: { ...state.lists, [project]: { fingerprint, rows, done, shallow_end: false, status: "ready" } } }));

const mount = () => client.flushSync(() => root.render(client.createElement(client.HistoryView, { live: true, measure: () => undefined })));

const unmount = () => client.flushSync(() => root.render(null));

const with_class = (class_name: string) => container.matching((element) => element.className.split(" ").includes(class_name));

before(async () => {
  const dom = install_dom(vx);
  restore = dom.restore;
  const window = Reflect.get(globalThis, "window") as Record<string, unknown>;
  window.setInterval = setInterval;
  window.clearInterval = clearInterval;
  client = await bundle(
    [
      'export { createElement } from "react";',
      'export { flushSync } from "react-dom";',
      'export { createRoot } from "react-dom/client";',
      'export { init_files, sync_files } from "./src/state/files.ts";',
      'export { git_store, git_ui_of, init_git } from "./src/state/git.ts";',
      'export { git_history_store, history_of, load_history } from "./src/state/git-history.ts";',
      'export { open_chat } from "./src/state/ui.ts";',
      'export { HistoryView } from "./src/features/docks/files/git/HistoryView.tsx";',
    ],
    [stub_components("none", {})],
  );
  client.init_files();
  client.init_git();
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
});

beforeEach(() => {
  calls.length = 0;
  main.history_calls = 0;
  main.hold_call = 0;
});

after(() => {
  root?.unmount();
  restore();
});

test("a deep reload that a chat switch to another project cuts off asks only for its own folder and leaves that folder's list alone", async () => {
  repos["D:/a"] = { fingerprint: "fa", rows: history_rows("a", 450) };
  repos["D:/b"] = { fingerprint: "fb", rows: history_rows("b", 450) };
  await switch_chat("c1", "D:/a");
  emit_view("D:/a", shown("D:/a"));
  set_list("D:/a", "old", history_rows("a", 450), true);
  main.hold_call = 1;
  const loading = client.load_history("D:/a", "fa");
  await settled();
  assert.equal(held.length, 1);
  await switch_chat("c2", "D:/b");
  emit_view("D:/b", shown("D:/b"));
  held.shift()?.release();
  await loading;
  await settled();
  assert.deepEqual(history_scopes(), ["D:/a"]);
  assert.equal(list_of("D:/a").fingerprint, "old");
  assert.equal(list_of("D:/a").rows.length, 450);
  assert.ok(list_of("D:/a").rows.every((row: GraphRow) => row.subject.startsWith("a ")));
  assert.equal(list_of("D:/b"), null);
});

test("a ref change that cuts off the read of the next page reloads the list instead of leaving it failed", async () => {
  repos["D:/c"] = { fingerprint: "f1", rows: history_rows("c", 450) };
  await switch_chat("c3", "D:/c");
  emit_view("D:/c", shown("D:/c"));
  main.hold_call = 2;
  mount();
  await settled();
  assert.equal(held.length, 1);
  repos["D:/c"] = { fingerprint: "f2", rows: [...history_rows("n", 1), ...repos["D:/c"].rows] };
  emit_view("D:/c", shown("D:/c"));
  await settled();
  held.shift()?.fail(new Error("git rev-list in D:/c was closed"));
  await settled();
  await settled();
  const list = list_of("D:/c");
  assert.equal(list.fingerprint, "f2");
  assert.equal(list.status, "ready");
  assert.equal(list.rows.length, 451);
  assert.equal(list.rows[0].subject, "n commit 0");
  assert.deepEqual(with_class("files-note"), []);
  unmount();
});

test("the scroll offset a chat leaves the history with is the one its user scrolled to, not one the next chat's shorter list forces", async () => {
  repos["D:/d"] = { fingerprint: "fd", rows: history_rows("d", 450) };
  repos["D:/e"] = { fingerprint: "fe", rows: history_rows("e", 20) };
  emit_view("D:/e", shown("D:/e"));
  set_list("D:/e", "fe", repos["D:/e"].rows, true);
  emit_view("D:/d", shown("D:/d"));
  set_list("D:/d", "fd", repos["D:/d"].rows, true);
  mount();
  await switch_chat("c5", "D:/e");
  await switch_chat("c4", "D:/d");
  const [scroller] = with_class("git-history");
  assert.ok(scroller);
  Object.assign(scroller, { scrollTop: 5200 });
  fire(scroller, "scroll");
  Object.assign(scroller, { scrollTop: 300 });
  await switch_chat("c5", "D:/e");
  assert.equal(client.git_ui_of(client.git_store.get(), "c4").history_top, 5200);
  assert.equal(Reflect.get(with_class("git-history")[0], "scrollTop"), 0);
  await switch_chat("c4", "D:/d");
  assert.equal(Reflect.get(with_class("git-history")[0], "scrollTop"), 5200);
  unmount();
});
