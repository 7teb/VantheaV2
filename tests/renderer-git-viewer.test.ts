import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { GitView } from "../shared/git-view.ts";
import type { FilesRoot } from "../shared/ipc/files.ts";
import { bundle, FakeElement, install_dom, stub_components, type Vx } from "./dom-kit.ts";
import { entry, repo } from "./git-view-kit.ts";

const calls: { name: string; args: unknown[] }[] = [];
const listeners = new Map<string, (payload: any) => void>();
const project: FilesRoot = { path: "D:/project", name: "project", kind: "project" };
const answers = { diff: async (): Promise<unknown> => ({ kind: "eol_only" }), counts: async (): Promise<unknown> => [] };

const vx: Vx = {
  invoke: async (name, ...args) => {
    calls.push({ name, args });
    if (name === "files:root") return project;
    if (name === "files:list") return { path: "", entries: [], more: 0 };
    if (name === "files:read") return { kind: "text", path: args[1], size: 4, text: "x", truncated: false };
    if (name === "git:diff") return answers.diff();
    if (name === "git:line_counts") return answers.counts();
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

Object.assign(FakeElement.prototype, { scrollTop: 0, clientHeight: 0, getBoundingClientRect: () => geometry });

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const emit_view = (view: GitView, at = "D:/project") => listeners.get("git:changed")?.({ root: at, view });

const show = async (chat_id: string) => {
  client.open_chat(chat_id, "D:/project");
  await client.sync_files();
  await settled();
};

const mount = (component: string, props: Record<string, unknown>) => client.flushSync(() => root.render(client.createElement(client[component], props)));

const asked = (name: string) => calls.filter((call) => call.name === name).map((call) => call.args.slice(1));

const press = (element: FakeElement) => {
  const props_key = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
  assert.ok(props_key);
  client.flushSync(() => (element as unknown as Record<string, { onClick: () => void }>)[props_key].onClick());
};

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
      'export { init_files, open_file, sync_files } from "./src/state/files.ts";',
      'export { drop_git_session, git_store, init_git, set_viewer_mode } from "./src/state/git.ts";',
      'export { init_git_diff } from "./src/state/git-diff.ts";',
      'export { open_chat } from "./src/state/ui.ts";',
      'export { FileViewer } from "./src/features/docks/files/FileViewer.tsx";',
      'export { ChangesList } from "./src/features/docks/files/git/ChangesList.tsx";',
    ],
    [stub_components("none", {})],
  );
  client.init_files();
  client.init_git();
  client.init_git_diff();
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
});

beforeEach(() => {
  calls.length = 0;
});

after(() => {
  root?.unmount();
  restore();
});

test("viewer diffs are asked for only while main serves the shown folder", async () => {
  await show("c1");
  const changed = () => repo({ entries: [entry("src/r.txt", "modified")] });
  emit_view(changed());
  client.set_viewer_mode("src/r.txt", "diff");
  await client.open_file("src/r.txt");
  client.drop_git_session();
  calls.length = 0;
  mount("FileViewer", { live: true, narrow: false });
  await settled();
  assert.deepEqual(asked("git:diff"), []);
  emit_view(changed());
  await settled();
  assert.deepEqual(asked("git:diff"), [["src/r.txt"]]);
  await show("c2");
  assert.equal(client.git_store.get().readable, null);
  emit_view(changed());
  assert.equal(client.git_store.get().readable, "D:/project");
  emit_view({ kind: "loading" }, "D:/other");
  assert.equal(client.git_store.get().readable, null);
});

test("a file removed from git but kept on disk has the File and Changes switch, a file gone from disk shows only its diff", async () => {
  await show("c3");
  answers.diff = async () => ({ kind: "text", lines: [{ kind: "remove", text: "x", old_line: 1, new_line: null }] });
  emit_view(
    repo({
      entries: [entry("kept.txt", "untracked", { unstaged: false }), entry("kept.txt", "deleted", { staged: true, unstaged: false }), entry("gone.txt", "deleted")],
    }),
  );
  const count = (class_name: string) => container.matching((element) => element.className.split(" ").includes(class_name)).length;
  await client.open_file("kept.txt");
  mount("FileViewer", { live: true, narrow: false });
  await settled();
  await settled();
  assert.deepEqual([count("git-mode"), count("files-text"), count("files-change-bar")], [1, 1, 0]);
  await client.open_file("gone.txt");
  await settled();
  assert.deepEqual([count("git-mode"), count("files-text")], [0, 0]);
  assert.ok(asked("git:diff").some(([path]) => path === "gone.txt"));
});

test("change rows are keyed by status and path, an untracked row opens as a file and counts wait until main serves the folder", async () => {
  await show("c4");
  const pair = () => repo({ entries: [entry("kept.txt", "deleted", { staged: true, unstaged: false }), entry("kept.txt", "untracked", { unstaged: false })] });
  emit_view(pair());
  client.drop_git_session();
  calls.length = 0;
  const opened: string[] = [];
  mount("ChangesList", { live: true, on_open: (path: string, mode: string) => opened.push(`${mode} ${path}`) });
  await settled();
  const rows = container.matching((element) => element.nodeName === "BUTTON" && element.className === "git-change");
  assert.equal(rows.length, 2);
  assert.deepEqual(asked("git:line_counts"), []);
  for (const row of rows) press(row);
  assert.deepEqual(opened, ["diff kept.txt", "file kept.txt"]);
  emit_view(pair());
  await settled();
  assert.equal(asked("git:line_counts").length, 1);
});
