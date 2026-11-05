import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { CommitDetail, GitView, GraphRow, HistoryPage, HistoryRequest } from "../shared/git-view.ts";
import type { FilesRoot } from "../shared/ipc/files.ts";
import { empty_lanes, lay_out } from "../shared/git/graph.ts";
import { bundle, FakeElement, install_dom, stub_components, type Vx } from "./dom-kit.ts";
import { repo } from "./git-view-kit.ts";

const calls: { name: string; args: unknown[] }[] = [];
const listeners = new Map<string, (payload: any) => void>();
const project: FilesRoot = { path: "D:/project", name: "project", kind: "project" };

const hash_of = (letter: string, index: number) => `${letter}${String(index).padStart(39, "0")}`;

const history_rows = (letter: string, count: number): GraphRow[] => {
  const commits = Array.from({ length: count }, (_value, index) => ({
    hash: hash_of(letter, index),
    parents: index + 1 < count ? [hash_of(letter, index + 1)] : [],
    author: "VantheaX Test",
    time: 1_700_000_000_000 - index * 60_000,
    subject: `${letter} commit ${index}`,
  }));
  return lay_out(commits, empty_lanes).rows.map((row) => ({ ...row, labels: [] }));
};

const served = { fingerprint: "f1", rows: history_rows("a", 250) };

const held: { release: () => void; fail: (error: Error) => void }[] = [];

const hold = { history: false, commit: false };

let undated = "";

const held_answer = <T>(answer: () => T): Promise<T> =>
  new Promise((resolve, reject) => held.push({ release: () => resolve(answer()), fail: reject }));

const page_of = (request: HistoryRequest): HistoryPage => {
  const start = request.fingerprint === served.fingerprint ? request.offset : 0;
  const rows = served.rows.slice(start, start + 200);
  return { fingerprint: served.fingerprint, start, rows, done: start + rows.length >= served.rows.length, shallow_end: false };
};

const detail_of = (hash: string): CommitDetail => ({
  hash,
  parents: [],
  author: "VantheaX Test",
  email: "test@example.invalid",
  time: hash === undated ? null : 1_700_000_000_000,
  message: "Subject line\n\nBody that is\nwrapped here",
  files: [{ status: "modified", path: "src/a.ts", orig_path: null, added: 1, removed: 2 }],
  counted: true,
});

const vx: Vx = {
  invoke: async (name, ...args) => {
    calls.push({ name, args });
    if (name === "files:root") return project;
    if (name === "files:list") return { path: "", entries: [], more: 0 };
    if (name === "git:history") return hold.history ? held_answer(() => page_of(args[1] as HistoryRequest)) : page_of(args[1] as HistoryRequest);
    if (name === "git:commit") return hold.commit ? held_answer(() => detail_of(args[1] as string)) : detail_of(args[1] as string);
    if (name === "git:commit_diff") return { kind: "text", lines: [{ kind: "add", text: "x", old_line: null, new_line: 1 }] };
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

let client: any;
let container: FakeElement;
let root: any;
let restore = () => {};

const geometry = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };

Object.assign(FakeElement.prototype, { scrollTop: 0, clientHeight: 0, scrollHeight: 0, getBoundingClientRect: () => geometry });

const settled = async () => {
  for (let round = 0; round < 6; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const emit_view = (view: GitView) => listeners.get("git:changed")?.({ root: "D:/project", view });

const shown = (fingerprint: string) => repo({ fingerprint, head: served.rows[0].hash });

const asked = (name: string) => calls.filter((call) => call.name === name).map((call) => call.args.slice(1));

const press = (element: FakeElement) => {
  const props_key = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
  assert.ok(props_key);
  client.flushSync(() => (element as unknown as Record<string, { onClick: () => void }>)[props_key].onClick());
};

const mount = () => client.flushSync(() => root.render(client.createElement(client.HistoryView, { live: true, measure: () => undefined })));

const unmount = () => client.flushSync(() => root.render(null));

const list = () => client.history_of(client.git_history_store.get(), "D:/project");

const rows_with = (class_name: string) => container.matching((element) => element.className.split(" ").includes(class_name));

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
      'export { drop_git_session, git_store, git_ui_of, init_git } from "./src/state/git.ts";',
      'export { git_history_store, history_of } from "./src/state/git-history.ts";',
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
  client.open_chat("h1", "D:/project");
  await client.sync_files();
  await settled();
});

beforeEach(() => {
  calls.length = 0;
});

after(() => {
  root?.unmount();
  restore();
});

test("the history asks main only while main serves the folder, loads the next page at the end and closes the stream when left", async () => {
  emit_view(shown("f1"));
  client.drop_git_session();
  mount();
  await settled();
  assert.deepEqual(asked("git:history"), []);
  assert.equal(rows_with("git-history-skeleton").length, 8);
  emit_view(shown("f1"));
  await settled();
  assert.deepEqual(asked("git:history"), [[{ fingerprint: null, offset: 0 }], [{ fingerprint: "f1", offset: 200 }]]);
  assert.equal(list().rows.length, 250);
  assert.equal(list().done, true);
  assert.deepEqual(asked("git:commit"), [[served.rows[0].hash]]);
  assert.equal(rows_with("commit-detail-title")[0]?.textContent, "Subject line");
  assert.equal(rows_with("commit-detail-body")[0]?.textContent, "Body that is wrapped here");
  unmount();
  assert.equal(asked("git:history_close").length, 1);
});

test("another fingerprint replaces the list and reloads it as deep as it was", async () => {
  served.fingerprint = "f2";
  served.rows = [...history_rows("b", 1), ...served.rows];
  mount();
  emit_view(shown("f2"));
  await settled();
  assert.deepEqual(asked("git:history"), [[{ fingerprint: null, offset: 0 }], [{ fingerprint: "f2", offset: 200 }]]);
  assert.equal(list().fingerprint, "f2");
  assert.equal(list().rows.length, 251);
  assert.equal(list().rows[0].subject, "b commit 0");
  unmount();
});

test("a chosen commit stays chosen while it is listed, a file of it opens its diff, and a rewritten history falls back to HEAD", async () => {
  mount();
  await settled();
  const commits = rows_with("git-commit");
  assert.ok(commits.length > 3);
  press(commits[3]);
  await settled();
  const chosen = list().rows[3].hash;
  assert.equal(client.git_ui_of(client.git_store.get(), "h1").commit, chosen);
  assert.deepEqual(asked("git:commit").at(-1), [chosen]);
  assert.equal(rows_with("git-commit")[3]?.getAttribute("data-active"), "true");
  const file = container.matching((element) => element.nodeName === "BUTTON" && element.className === "git-change")[0];
  assert.ok(file);
  press(file);
  await settled();
  assert.deepEqual(asked("git:commit_diff"), [[chosen, "src/a.ts"]]);
  served.fingerprint = "f3";
  served.rows = history_rows("c", 5);
  emit_view(repo({ fingerprint: "f3", head: served.rows[0].hash }));
  await settled();
  assert.equal(list().fingerprint, "f3");
  assert.deepEqual(asked("git:commit").at(-1), [served.rows[0].hash]);
  assert.equal(rows_with("git-commit")[0]?.getAttribute("data-active"), "true");
  unmount();
});

test("leaving while a page loads closes the stream once the page is in, and a read cut off by hiding the panel is asked again", async () => {
  served.fingerprint = "f4";
  served.rows = history_rows("d", 3);
  hold.history = true;
  mount();
  emit_view(shown("f4"));
  await settled();
  assert.equal(held.length, 1);
  unmount();
  assert.equal(asked("git:history_close").length, 0);
  held.shift()?.release();
  await settled();
  assert.equal(asked("git:history_close").length, 1);
  hold.history = false;
  hold.commit = true;
  served.fingerprint = "f5";
  served.rows = history_rows("e", 3);
  calls.length = 0;
  mount();
  emit_view(shown("f5"));
  await settled();
  assert.deepEqual(asked("git:commit"), [[served.rows[0].hash]]);
  client.drop_git_session();
  held.shift()?.fail(new Error("the git session stopped"));
  await settled();
  assert.equal(client.git_history_store.get().commits[`D:/project
${served.rows[0].hash}`], undefined);
  hold.commit = false;
  emit_view(shown("f5"));
  await settled();
  assert.deepEqual(asked("git:commit"), [[served.rows[0].hash], [served.rows[0].hash]]);
  assert.equal(rows_with("commit-detail-title")[0]?.textContent, "Subject line");
  unmount();
});

test("a commit without a readable date shows no time in its row and no date in its details", async () => {
  served.fingerprint = "f6";
  served.rows = history_rows("g", 3).map((row, index) => (index === 0 ? { ...row, time: null } : row));
  undated = served.rows[0].hash;
  mount();
  emit_view(shown("f6"));
  await settled();
  assert.equal(rows_with("git-commit").length, 3);
  assert.equal(rows_with("git-commit-time").length, 2);
  assert.deepEqual(asked("git:commit").at(-1), [undated]);
  const [meta] = rows_with("commit-detail-meta");
  assert.ok(meta);
  assert.equal(meta.matching((element) => element.className === "git-sep").length, 1);
  assert.equal(rows_with("commit-detail-author")[0]?.textContent, "VantheaX Test");
  unmount();
});
