import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { GitEntry, GitView } from "../shared/git-view.ts";
import type { DirListing, FilesRoot, FilesScope } from "../shared/ipc/files.ts";
import { bundle, install_dom, stub_components, type FakeElement, type Vx } from "./dom-kit.ts";
import { entry, repo } from "./git-view-kit.ts";

const calls: { name: string; args: unknown[] }[] = [];
const listeners = new Map<string, (payload: any) => void>();
const project: FilesRoot = { path: "D:/project", name: "project", kind: "project" };
let listing: DirListing = { path: "", entries: [], more: 0 };
const answers = { diff: async (_path: unknown): Promise<unknown> => ({ kind: "eol_only" }), counts: async (): Promise<unknown> => [] };

const vx: Vx = {
  invoke: async (name, ...args) => {
    calls.push({ name, args });
    if (name === "files:root") return project;
    if (name === "files:list") return listing;
    if (name === "git:diff") return answers.diff(args[1]);
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

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const emit_view = (view: GitView, at = "D:/project") => listeners.get("git:changed")?.({ root: at, view });

const shown_git = (): GitView => client.git_view_of(client.git_store.get(), "D:/project");

const render = (component: string) => client.flushSync(() => root.render(client.createElement(client[component])));

const card_text = () => {
  render("GitCard");
  return container.textContent;
};

const show = async (chat_id: string) => {
  client.open_chat(chat_id, "D:/project");
  await client.sync_files();
  await settled();
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
      'export { init_files, sync_files } from "./src/state/files.ts";',
      'export { adopt_git, changed_entries, decorations_of, git_store, git_ui_of, git_view_of, init_git, refresh_git, select_commit, set_surface, set_viewer_mode, toggle_commit_file } from "./src/state/git.ts";',
      'export { counts_of, diff_of, git_diff_store, init_git_diff, load_counts, load_diff } from "./src/state/git-diff.ts";',
      'export { open_chat } from "./src/state/ui.ts";',
      'export { GitCard } from "./src/features/docks/files/git/GitCard.tsx";',
      'export { FileTree } from "./src/features/docks/files/FileTree.tsx";',
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

test("the git state belongs to the folder and stays when the user switches between chats of that project", async () => {
  await show("c1");
  emit_view(repo());
  assert.match(card_text(), /^main/);
  await show("c2");
  assert.equal(shown_git().kind, "repo");
  assert.match(card_text(), /^main/);
  assert.equal(calls.filter((call) => call.name.startsWith("git:") && call.name !== "git:write_guard").length, 0);
});

test("a loading event keeps the last known state and only replaces an unknown or empty one", () => {
  const known = repo();
  emit_view(known);
  emit_view({ kind: "loading" });
  assert.equal(shown_git(), known);
  emit_view({ kind: "loading" }, "D:/fresh");
  assert.equal(client.git_view_of(client.git_store.get(), "D:/fresh").kind, "loading");
  emit_view({ kind: "none" });
  emit_view({ kind: "loading" });
  assert.equal(shown_git().kind, "loading");
  assert.equal(client.git_view_of(client.git_store.get(), "D:/elsewhere").kind, "none");
});

test("refresh asks main for the folder of the shown chat", async () => {
  await show("c2");
  calls.length = 0;
  client.refresh_git();
  assert.deepEqual(
    calls.map((call) => [call.name, call.args[0] as FilesScope]),
    [["git:refresh", { chat_id: "c2", project_path: "D:/project" }]],
  );
});

test("tree decorations are built once per git state", () => {
  const first = repo({ entries: [entry("src/a.ts", "modified")] });
  assert.equal(client.decorations_of(first), client.decorations_of(first));
  assert.notEqual(client.decorations_of(first), client.decorations_of(repo({ entries: [entry("src/a.ts", "modified")] })));
  assert.equal(client.decorations_of({ kind: "none" }), null);
});

test("the local row names the branch state, the tracking numbers and the fetch time", async () => {
  await show("c1");
  emit_view(repo());
  assert.equal(card_text(), "main·40·not fetched yetPush");
  emit_view(repo({ fetch: { at: new Date(Date.now() - 5.5 * 60_000).toISOString(), running: false, error: null, blocked: null, queued: false } }, { stash: 2 }));
  assert.equal(card_text(), "main·40·5m ago·2 stash entriesPush");
  emit_view(repo({ refreshing: true }));
  assert.equal(card_text(), "main·40·Reading statusPush");
  emit_view(repo({}, { name: null, detached_at: "4276a37f0c1d2e3b4a5968778695a4b3c2d1e0f9", upstream: null, ahead: null, behind: null }));
  assert.equal(card_text(), "4276a37·detached");
  emit_view(repo({}, { unborn: true, upstream: null, ahead: null, behind: null }));
  assert.equal(card_text(), "main·no commits yet");
  emit_view(repo({}, { upstream: null, ahead: null, behind: null }));
  assert.equal(card_text(), "main·local onlyPush");
  emit_view(repo({ remotes: [], primary_remote: null }, { upstream: null, ahead: null, behind: null }));
  assert.equal(card_text(), "main");
  emit_view(repo({}, { name: "feature", upstream: "origin/feature", upstream_gone: true, ahead: null, behind: null }));
  assert.equal(card_text(), "feature·origin/feature no longer existsPush");
});

test("a running operation and a failed watcher get their own rows below the branch", async () => {
  await show("c1");
  emit_view(
    repo({
      operation: { kind: "rebase", step: 2, total: 5, branch: "main" },
      entries: [entry("a.ts", "conflicted", { conflict: "UU" }), entry("b.ts", "modified")],
      watch_failed: true,
    }),
  );
  assert.equal(card_text(), "main·40·not fetched yetRebase·Step 2 of 5·1 conflictChanges are not detected automatically");
  const waiting = container.matching((element) => element.getAttribute("data-tone") === "waiting");
  assert.equal(waiting.length, 1);
});

test("states without a branch show one notice row with at most one action", async () => {
  await show("c1");
  emit_view({ kind: "git_missing" });
  assert.equal(card_text(), "Git is not installedDownload Git for Windows");
  emit_view({ kind: "git_too_old", version: "2.40.1", reason: "partial_clone" });
  assert.equal(card_text(), "Git 2.40.1 is too oldPartial clones need 2.45 or newerDownload Git for Windows");
  emit_view({ kind: "blocked_ownership", path: "D:/My Repo" });
  assert.equal(card_text(), "Repository belongs to another usergit config --global --add safe.directory 'D:/My Repo'");
  emit_view({ kind: "blocked_ownership", path: "D:/VantheaX" });
  assert.equal(card_text(), "Repository belongs to another usergit config --global --add safe.directory D:/VantheaX");
  emit_view({ kind: "outside_tracked", repo_root: "C:/Users/x" });
  assert.equal(card_text(), "Folder is not trackedIn the repository C:/Users/x");
  emit_view({ kind: "error", message: "fatal: bad config line 12 in file .git/config", broken_gitfile: false });
  assert.equal(card_text(), "Git reported an errorfatal: bad config line 12 in file .git/config");
  assert.equal(container.matching((element) => element.getAttribute("role") === "alert").length, 1);
  emit_view({ kind: "error", message: "fatal: not a git repository: (NULL)", broken_gitfile: true });
  assert.equal(card_text(), ".git points to a missing folder");
  emit_view({ kind: "none" });
  assert.equal(card_text(), "");
  emit_view({ kind: "loading" });
  render("GitCard");
  assert.equal(container.matching((element) => element.getAttribute("aria-busy") === "true").length, 1);
});

test("tree rows carry the letter, the folder dot and the dimmed state of ignored entries", async () => {
  listing = {
    path: "",
    entries: [
      { name: "src", path: "src", kind: "dir" },
      { name: "node_modules", path: "node_modules", kind: "dir" },
      { name: "vendor", path: "vendor", kind: "dir" },
      { name: "a.ts", path: "a.ts", kind: "file" },
      { name: "b.ts", path: "b.ts", kind: "file" },
      { name: "new.ts", path: "new.ts", kind: "file" },
    ],
    more: 0,
  };
  await show("c3");
  emit_view(
    repo({
      entries: [
        entry("src/x.ts", "modified"),
        entry("a.ts", "modified", { staged: true, unstaged: false }),
        entry("b.ts", "conflicted", { conflict: "UU" }),
        entry("new.ts", "untracked", { unstaged: false }),
        entry("node_modules/", "ignored", { unstaged: false }),
        entry("vendor/", "untracked", { unstaged: false, nested_repo: true }),
      ],
    }),
  );
  render("FileTree");
  const row = (path: string) => container.matching((element) => element.nodeName === "BUTTON" && element.getAttribute("title")?.split("\n")[0] === path)[0];
  const badge = (path: string) => row(path)?.matching((element) => element.className === "git-badge")[0];
  assert.equal(row("src")?.getAttribute("data-git"), null);
  assert.equal(badge("src")?.getAttribute("data-git"), "modified");
  assert.equal(badge("src")?.getAttribute("title"), "Contains changes");
  assert.equal(badge("src")?.textContent, "");
  assert.equal(row("a.ts")?.getAttribute("data-git"), "modified");
  assert.equal(badge("a.ts")?.textContent, "M");
  assert.equal(badge("a.ts")?.getAttribute("title"), "Modified, staged");
  assert.equal(badge("b.ts")?.textContent, "!");
  assert.equal(badge("b.ts")?.getAttribute("title"), "Conflict: both modified");
  assert.equal(badge("new.ts")?.textContent, "U");
  assert.equal(row("node_modules")?.getAttribute("data-git"), "ignored");
  assert.equal(badge("node_modules"), undefined);
  assert.equal(badge("vendor"), undefined);
  assert.equal(row("vendor")?.getAttribute("title"), "vendor\nOwn repository");
});

test("during a rebase the local row names the rebased branch, not the detached commit", async () => {
  await show("c1");
  const detached = { name: null, detached_at: "4276a37f0c1d2e3b4a5968778695a4b3c2d1e0f9", upstream: null, ahead: null, behind: null };
  emit_view(repo({ operation: { kind: "rebase", step: 2, total: 5, branch: "list/fu-browser" }, entries: [entry("a.ts", "conflicted", { conflict: "UU" })] }, detached));
  assert.equal(card_text(), "list/fu-browserRebase·Step 2 of 5·1 conflict");
  emit_view(repo({ operation: { kind: "am", step: 1, total: 3, branch: null } }, detached));
  assert.match(card_text(), /^4276a37·detached/);
});

test("a submodule shows S from its gitlink, also when it is only added or bumped in the index", async () => {
  listing = {
    path: "",
    entries: [
      { name: "added", path: "added", kind: "dir" },
      { name: "bumped", path: "bumped", kind: "dir" },
      { name: "dirty", path: "dirty", kind: "dir" },
    ],
    more: 0,
  };
  await show("c4");
  const clean = { commit: false, tracked: false, untracked: false };
  emit_view(
    repo({
      entries: [
        entry("added", "added", { staged: true, unstaged: false, submodule: clean }),
        entry("bumped", "modified", { staged: true, unstaged: false, submodule: clean }),
        entry("dirty", "modified", { submodule: { commit: true, tracked: true, untracked: false } }),
      ],
    }),
  );
  render("FileTree");
  const badge = (path: string) =>
    container
      .matching((element) => element.nodeName === "BUTTON" && element.getAttribute("title")?.split("\n")[0] === path)[0]
      ?.matching((element) => element.className === "git-badge")[0];
  assert.deepEqual([badge("added")?.textContent, badge("added")?.getAttribute("title")], ["S", "Submodule: Added, staged"]);
  assert.deepEqual([badge("bumped")?.textContent, badge("bumped")?.getAttribute("title")], ["S", "Submodule: Modified, staged"]);
  assert.deepEqual([badge("dirty")?.textContent, badge("dirty")?.getAttribute("title")], ["S", "Submodule: new commit, modified files"]);
});

test("the chosen view, the viewer modes and the chosen commit belong to the chat, a new chat keeps them and a deleted chat drops them", async () => {
  await show("c1");
  client.set_surface("changes");
  client.set_viewer_mode("src/a.ts", "diff");
  client.select_commit("abc1234");
  client.toggle_commit_file("abc1234", "src/a.ts");
  await show("c2");
  assert.deepEqual(client.git_ui_of(client.git_store.get(), "c2"), { surface: "files", modes: {}, commit: null, commit_file: null, history_top: 0 });
  await show("c1");
  const chosen = { surface: "changes", modes: { "src/a.ts": "diff" }, commit: "abc1234", commit_file: { hash: "abc1234", path: "src/a.ts" }, history_top: 0 };
  assert.deepEqual(client.git_ui_of(client.git_store.get(), "c1"), chosen);
  client.toggle_commit_file("abc1234", "src/a.ts");
  assert.equal(client.git_ui_of(client.git_store.get(), "c1").commit_file, null);
  client.toggle_commit_file("abc1234", "src/a.ts");
  client.adopt_git("c1", "c7");
  assert.deepEqual(client.git_ui_of(client.git_store.get(), "c7"), chosen);
  assert.equal(client.git_store.get().ui.c1, undefined);
  listeners.get("chats:removed")?.({ chat_id: "c7" });
  assert.equal(client.git_store.get().ui.c7, undefined);
});

test("the change list leaves out ignored entries and is built once per git state", () => {
  const view = repo({ entries: [entry("a.ts", "modified"), entry("dist/", "ignored"), entry("new.ts", "untracked")] });
  assert.deepEqual(client.changed_entries(view).map((change: GitEntry) => change.path), ["a.ts", "new.ts"]);
  assert.equal(client.changed_entries(view), client.changed_entries(view));
  assert.deepEqual(client.changed_entries({ kind: "loading" }), []);
});

test("a diff is asked for the shown chat, goes stale on a new git state or a file change and is dropped once the path is no longer changed", async () => {
  await show("c1");
  const changed = repo({ entries: [entry("src/a.ts", "modified"), entry("src/b.ts", "modified")] });
  emit_view(changed);
  answers.diff = async () => ({ kind: "text", lines: [{ kind: "add", text: "x", old_line: null, new_line: 1 }] });
  calls.length = 0;
  await client.load_diff("D:/project", "src/a.ts");
  assert.deepEqual(calls.map((call) => [call.name, ...call.args]), [["git:diff", { chat_id: "c1", project_path: "D:/project" }, "src/a.ts"]]);
  const loaded = client.diff_of(client.git_diff_store.get(), "D:/project", "src/a.ts");
  assert.deepEqual([loaded.status, loaded.value.kind, loaded.fresh], ["ready", "text", true]);
  listeners.get("files:changed")?.({ root: "D:/project", paths: ["src/other.ts"], overflow: false });
  assert.equal(client.diff_of(client.git_diff_store.get(), "D:/project", "src/a.ts"), loaded);
  listeners.get("files:changed")?.({ root: "D:/project", paths: ["src"], overflow: false });
  const stale = client.diff_of(client.git_diff_store.get(), "D:/project", "src/a.ts");
  assert.deepEqual([stale.status, stale.value, stale.fresh], ["ready", loaded.value, false]);
  await client.load_diff("D:/project", "src/a.ts");
  emit_view(repo({ entries: [entry("src/a.ts", "modified")] }));
  assert.equal(client.diff_of(client.git_diff_store.get(), "D:/project", "src/a.ts").fresh, false);
  emit_view(repo({ entries: [entry("src/b.ts", "modified")] }));
  assert.equal(client.diff_of(client.git_diff_store.get(), "D:/project", "src/a.ts"), null);
});

test("a failed diff or count read keeps what was shown and is not retried until something changes", async () => {
  await show("c1");
  emit_view(repo({ entries: [entry("src/c.ts", "modified")] }));
  answers.counts = async () => [{ path: "src/c.ts", added: 2, removed: 1 }];
  await client.load_counts("D:/project");
  answers.counts = async () => {
    throw new Error("git is gone");
  };
  listeners.get("files:changed")?.({ root: "D:/project", paths: [], overflow: true });
  const failures = console.error;
  console.error = () => {};
  try {
    await client.load_counts("D:/project");
  } finally {
    console.error = failures;
  }
  const counts = client.counts_of(client.git_diff_store.get(), "D:/project");
  assert.deepEqual([counts.status, counts.value, counts.fresh], ["failed", [{ path: "src/c.ts", added: 2, removed: 1 }], true]);
});
