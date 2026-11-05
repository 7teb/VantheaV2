import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { GitFileDiff } from "../shared/git-view.ts";
import type { DiffScope, DiffSummary } from "../shared/turn-diff.ts";
import { bundle, FakeElement, install_dom, stub_components, type Vx } from "./dom-kit.ts";
import { diff_entry, edit_step, ready } from "./turn-diff-ui-kit.ts";

const calls: { name: string; args: unknown[] }[] = [];
const listeners = new Map<string, ((payload: any) => void)[]>();
const answers = {
  summaries: async (_chat_id: string, scopes: DiffScope[]): Promise<DiffSummary[]> => scopes.map((): DiffSummary => ({ kind: "none" })),
  file: async (_path: string): Promise<GitFileDiff> => ({ kind: "unchanged" }),
};

const vx: Vx = {
  invoke: async (name, ...args) => {
    calls.push({ name, args });
    if (name === "turn_diff:summaries") return answers.summaries(args[0] as string, args[1] as DiffScope[]);
    if (name === "turn_diff:file") return answers.file(args[2] as string);
    if (name === "files:root") return null;
    return undefined;
  },
  on: (name, listener) => {
    listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    return () => listeners.set(name, (listeners.get(name) ?? []).filter((entry) => entry !== listener));
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

const fire = (name: string, payload: unknown) => {
  for (const listener of listeners.get(name) ?? []) listener(payload);
};

const asked = (name: string) => calls.filter((call) => call.name === name).map((call) => call.args);

const mount = (component: string, props: Record<string, unknown>) => client.flushSync(() => root.render(client.createElement(client[component], props)));

const text = () => container.textContent;

const press = (element: FakeElement) => {
  const props_key = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
  assert.ok(props_key);
  client.flushSync(() => (element as unknown as Record<string, { onClick: () => void }>)[props_key].onClick());
};

const buttons = () => container.matching((element) => element.nodeName === "BUTTON");

const turn = (from_id: string, to_id = from_id): DiffScope => ({ kind: "turn", from_id, to_id });

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
      'export { init_files, files_store } from "./src/state/files.ts";',
      'export { git_store, git_ui_of, init_git } from "./src/state/git.ts";',
      'export { open_chat, ui_store } from "./src/state/ui.ts";',
      'export { init_turn_diff, reload_live, request_file, request_summary, turn_diff_store } from "./src/state/turn-diff.ts";',
      'export { init_turn_diff_ui, pick_surface, turn_diff_ui_of, turn_diff_ui_store } from "./src/state/turn-diff-ui.ts";',
      'export { FileChanges } from "./src/features/chat/FileChanges.tsx";',
      'export { TurnDiffList } from "./src/features/docks/files/diff/TurnDiffList.tsx";',
      'export { TurnDiffViewer } from "./src/features/docks/files/diff/TurnDiffViewer.tsx";',
    ],
    [stub_components("none", {})],
  );
  client.init_files();
  client.init_git();
  client.init_turn_diff();
  client.init_turn_diff_ui();
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
});

beforeEach(() => {
  calls.length = 0;
  answers.summaries = async (_chat_id, scopes) => scopes.map((): DiffSummary => ({ kind: "none" }));
  answers.file = async () => ({ kind: "unchanged" });
});

after(() => {
  root?.unmount();
  restore();
});

test("summaries asked in one tick go out as one call per chat, ahead of a file asked in the same tick", async () => {
  client.request_summary("s1", turn("a1"));
  client.request_summary("s1", turn("a2", "a3"));
  client.request_summary("s1", turn("a1"));
  client.request_summary("s2", { kind: "chat" });
  client.request_file("s1", turn("a1"), "src/x.ts");
  assert.equal(calls.length, 0);
  await settled();
  assert.deepEqual(
    calls.map((call) => call.name),
    ["turn_diff:summaries", "turn_diff:summaries", "turn_diff:file"],
  );
  assert.deepEqual(asked("turn_diff:summaries"), [
    ["s1", [turn("a1"), turn("a2", "a3")]],
    ["s2", [{ kind: "chat" }]],
  ]);
  const state = client.turn_diff_store.get();
  assert.deepEqual(state.summaries["s1\na1:a1"], { status: "ready", value: { kind: "none" }, fresh: true });
  assert.equal(state.files["s1\na1:a1\nsrc/x.ts"].status, "ready");
});

test("turn_diff:changed marks only that chat stale, live reloads touch only live ends and chats:removed drops the chat", async () => {
  answers.summaries = async (_chat_id, scopes) =>
    scopes.map((scope) => (scope.kind === "chat" ? ready([diff_entry("a.txt")], { end: { kind: "live", at: "2026-10-26T14:09:00.000Z" } }) : ready([diff_entry("a.txt")])));
  client.request_summary("s3", turn("a1"));
  client.request_summary("s3", { kind: "chat" });
  client.request_summary("s4", turn("b1"));
  client.request_file("s3", { kind: "chat" }, "a.txt");
  client.request_file("s3", turn("a1"), "a.txt");
  await settled();
  const fresh = () => {
    const { summaries, files } = client.turn_diff_store.get();
    return [summaries["s3\na1:a1"].fresh, summaries["s3\nchat"].fresh, summaries["s4\nb1:b1"].fresh, files["s3\nchat\na.txt"].fresh, files["s3\na1:a1\na.txt"].fresh];
  };
  client.reload_live("s3");
  assert.deepEqual(fresh(), [true, false, true, false, true]);
  fire("turn_diff:changed", { chat_id: "s3" });
  assert.deepEqual(fresh(), [false, false, true, false, false]);
  fire("chats:removed", { chat_id: "s3" });
  const { summaries, files } = client.turn_diff_store.get();
  assert.deepEqual(Object.keys(summaries).filter((key) => key.startsWith("s3\n")), []);
  assert.deepEqual(Object.keys(files).filter((key) => key.startsWith("s3\n")), []);
  assert.ok(summaries["s4\nb1:b1"]);
});

test("the card shows edit rows at once, switches to the snapshot rows and offers Show diff", async () => {
  client.open_chat("c1", "D:/project");
  let release = (_value: DiffSummary[]) => {};
  answers.summaries = () => new Promise((resolve) => (release = resolve));
  mount("FileChanges", { chat_id: "c1", steps: [edit_step("e1", "src/a.ts", 2, 1)], from_id: "a1", to_id: "a2", undo_id: null, busy: false });
  assert.match(text(), /1 file edited/);
  assert.match(text(), /Show diff/);
  await settled();
  assert.deepEqual(asked("turn_diff:summaries"), [["c1", [turn("a1", "a2")]]]);
  release([ready([diff_entry("src/a.ts"), diff_entry("dist/a.js", "added"), diff_entry("old.txt", "deleted")])]);
  await settled();
  assert.match(text(), /3 files changed/);
  const show = buttons().find((button) => button.textContent === "Show diff");
  assert.ok(show);
  press(show);
  assert.equal(client.ui_store.get().dock.kind, "files");
  const key = client.files_store.get().key;
  assert.equal(client.git_ui_of(client.git_store.get(), key).surface, "diff");
  assert.deepEqual(client.turn_diff_ui_of(client.turn_diff_ui_store.get(), key), { range: "turn", span: { from_id: "a1", to_id: "a2" }, pinned_with: null, path: null });
  const deleted = buttons().find((button) => button.getAttribute("data-deleted") === "true");
  assert.ok(deleted);
  press(deleted);
  assert.equal(client.turn_diff_ui_of(client.turn_diff_ui_store.get(), key).path, "old.txt");
  client.pick_surface("files");
  assert.deepEqual(client.turn_diff_ui_of(client.turn_diff_ui_store.get(), key).span, { from_id: "a1", to_id: "a2" });
  client.pick_surface("diff");
  assert.equal(client.turn_diff_ui_of(client.turn_diff_ui_store.get(), key).span, null, "choosing Diff in the switch shows the newest turn again");
});

test("a turn without edit steps gets a card only once its snapshot summary has entries", async () => {
  client.open_chat("c2", "D:/project");
  mount("FileChanges", { chat_id: "c2", steps: [], from_id: "a1", to_id: "a1", undo_id: null, busy: false });
  await settled();
  await settled();
  assert.equal(text(), "");
  answers.summaries = async () => [ready([diff_entry("dist/app.js", "added", { added: 12, removed: 0 })])];
  fire("turn_diff:changed", { chat_id: "c2" });
  await settled();
  await settled();
  assert.match(text(), /1 file changed/);
  assert.match(text(), /dist\/app\.js/);
});

const model = (summary: DiffSummary | null, range: "turn" | "chat" = "turn") => {
  const entries = summary?.kind === "ready" ? summary.entries : [];
  return {
    has_turns: true,
    range,
    scope: range === "chat" ? { kind: "chat" } : turn("a1"),
    started_at: null,
    load: summary === null ? null : { status: "ready", value: summary, fresh: true },
    entries,
    selected: entries[0] ?? null,
  };
};

test("the list shows a skeleton, the empty and failed states, notes, the count and one row per entry", () => {
  const skeleton = () => container.matching((element) => element.getAttribute("aria-busy") === "true").length;
  mount("TurnDiffList", { model: model(null), on_open: () => {} });
  assert.equal(skeleton(), 1);
  mount("TurnDiffList", { model: model({ kind: "none" }), on_open: () => {} });
  assert.match(text(), /No snapshot exists for this turn/);
  mount("TurnDiffList", { model: model({ kind: "none" }, "chat"), on_open: () => {} });
  assert.match(text(), /No snapshot exists for this chat yet/);
  mount("TurnDiffList", { model: model({ kind: "failed", error: "fatal: bad tree" }), on_open: () => {} });
  assert.match(text(), /The diff could not be read: fatal: bad tree/);
  mount("TurnDiffList", { model: model(ready([], { source: "recorded", notes: [{ kind: "no_git", reason: "not_repo", detail: "" }] })), on_open: () => {} });
  assert.match(text(), /Not a Git repository: only files written/);
  assert.match(text(), /No files changed in this turn/);
  const opened: string[] = [];
  const entries = [
    diff_entry("src/a.ts", "modified", { added: 5, removed: 2 }),
    diff_entry("logo.png", "added", { added: null, removed: null, binary: true }),
    diff_entry("vendor/lib", "submodule", { commits: { from: "a1b2c3d4e5", to: null } }),
  ];
  mount("TurnDiffList", { model: model(ready(entries, { notes: [{ kind: "renames_skipped" }] }), "chat"), on_open: (entry: { path: string }) => opened.push(entry.path) });
  assert.match(text(), /3 files\+5-2/);
  assert.match(text(), /Git skipped rename detection/);
  assert.match(text(), /binary/);
  assert.match(text(), /a1b2c3d → none/);
  const rows = container.matching((element) => element.className === "git-change");
  assert.deepEqual(
    rows.map((row) => row.nodeName),
    ["BUTTON", "BUTTON", "DIV"],
  );
  assert.equal(rows[0]?.getAttribute("data-active"), "true");
  for (const row of rows.filter((element) => element.nodeName === "BUTTON")) press(row);
  assert.deepEqual(opened, ["src/a.ts", "logo.png"]);
});

test("the viewer loads one file of the shown diff and names binary, missing and failed reads", async () => {
  const show = async (diff: () => Promise<GitFileDiff>, path: string) => {
    answers.file = diff;
    mount("TurnDiffViewer", { key: path, chat_id: "v1", scope: turn("a1"), entry: diff_entry(path), live: true });
    await settled();
    await settled();
  };
  await show(async () => ({ kind: "binary" }), "img.png");
  assert.match(text(), /Binary file, no line diff/);
  assert.deepEqual(asked("turn_diff:file").at(-1), ["v1", turn("a1"), "img.png"]);
  await show(async () => ({ kind: "object_missing" }), "gone.txt");
  assert.match(text(), /The snapshot content of this file is no longer available/);
  const logged: string[] = [];
  const log = console.error;
  console.error = (message: string) => void logged.push(message);
  try {
    await show(async () => {
      throw new Error("boom");
    }, "broken.txt");
  } finally {
    console.error = log;
  }
  assert.deepEqual(logged, ["[turn-diff] turn_diff:file failed for broken.txt in the diff a1:a1 of chat v1"]);
  assert.match(text(), /The changes could not be read/);
  await show(async () => ({ kind: "text", lines: [{ kind: "add", text: "hello", old_line: null, new_line: 1 }] }), "new.txt");
  assert.equal(container.matching((element) => element.className === "git-diff").length, 1);
  assert.match(text(), /\+1/);
});
