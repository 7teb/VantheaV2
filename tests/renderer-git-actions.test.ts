import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { GitView } from "../shared/git-view.ts";
import type { GithubData } from "../shared/github-view.ts";
import type { FilesRoot } from "../shared/ipc/files.ts";
import { bundle, install_dom, stub_components, type FakeElement, type Vx } from "./dom-kit.ts";
import { entry, repo } from "./git-view-kit.ts";

const calls: { name: string; args: unknown[] }[] = [];
const listeners = new Map<string, (payload: any) => void>();
const project: FilesRoot = { path: "D:/project", name: "project", kind: "project" };
const answers = new Map<string, unknown>();
const ref = { host: "github.com", owner: "7teb", name: "VantheaX" };

const vx: Vx = {
  invoke: async (name, ...args) => {
    calls.push({ name, args });
    if (name === "files:root") return project;
    if (name === "files:list") return { path: "", entries: [], more: 0 };
    return answers.get(name);
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

const emit_view = (view: GitView) => listeners.get("git:changed")?.({ root: "D:/project", view });

const emit_github = (view: GithubData) => listeners.get("github:repo_changed")?.({ root: "D:/project", view });

const shown = (component: string, props: Record<string, unknown> = {}) => {
  client.flushSync(() => root.render(client.createElement(client[component], props)));
  return container.textContent;
};

const actions = () => client.actions_of(client.git_actions_store.get(), "D:/project");

const draft = () => client.pr_of(client.git_pr_store.get(), "D:/project");

const button_named = (label: string): FakeElement | undefined => container.matching((element) => element.nodeName === "BUTTON" && element.textContent === label)[0];

const data = (extra: Partial<GithubData> = {}): GithubData => ({
  kind: "data",
  repo: ref,
  html_url: "https://github.com/7teb/VantheaX",
  default_branch: "main",
  visibility: "private",
  archived: false,
  fork_parent: null,
  renamed_from: null,
  branch: { kind: "none" },
  pr: null,
  checks: null,
  source: "gh",
  source_login: "octocat",
  updated_at: "2026-10-26T12:00:00.000Z",
  stale: null,
  ...extra,
});

const changed = repo({ entries: [entry("a.ts", "modified"), entry("b.ts", "added")] }, { name: "feature", upstream: "origin/feature", ahead: 2 });

before(async () => {
  const dom = install_dom(vx);
  restore = dom.restore;
  client = await bundle(
    [
      'export { createElement } from "react";',
      'export { flushSync } from "react-dom";',
      'export { createRoot } from "react-dom/client";',
      'export { init_files, sync_files } from "./src/state/files.ts";',
      'export { init_git } from "./src/state/git.ts";',
      'export { init_github } from "./src/state/github.ts";',
      'export { chats_store } from "./src/state/chats.ts";',
      'export { actions_of, commit_changes, git_actions_store, init_git_actions, push_branch, set_commit_message, write_commit_message } from "./src/state/git-actions.ts";',
      'export { close_pr, create_pr, git_pr_store, init_git_pr, open_pr, pr_of, set_pr_text } from "./src/state/git-pr.ts";',
      'export { open_chat } from "./src/state/ui.ts";',
      'export { CommitBox } from "./src/features/docks/files/git/CommitBox.tsx";',
      'export { GitActions } from "./src/features/docks/files/git/GitActions.tsx";',
      'export { PrComposer } from "./src/features/docks/files/git/PrComposer.tsx";',
    ],
    [stub_components("none", {})],
  );
  client.init_files();
  client.init_git();
  client.init_github();
  client.init_git_actions();
  client.init_git_pr();
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
  client.open_chat("c1", "D:/project");
  await client.sync_files();
  await settled();
});

beforeEach(() => {
  calls.length = 0;
  answers.clear();
  answers.set("git:write_guard", { hooks_off: false, commit_block: [], push_block: [] });
  client.chats_store.set({ status: "ready", list: [{ id: "c1", title: "c1", project_path: "D:/project", workspace: "", pinned: false, created_at: "", updated_at: "", message_count: 1, streaming: false }] });
  client.git_actions_store.set({ roots: {} });
  client.git_pr_store.set({ drafts: {} });
  emit_view(changed);
  emit_github(data());
});

after(() => {
  root?.unmount();
  restore();
});

test("write message fills the box, commit sends it, clears it and names the left-out files", async () => {
  assert.match(shown("CommitBox", { view: changed }), /Write message$/);
  answers.set("git:write_message", { kind: "text", text: "Add the parser" });
  await client.write_commit_message();
  assert.equal(actions().commit.message, "Add the parser");
  assert.match(shown("CommitBox", { view: changed }), /Commit 2 files$/);
  answers.set("git:commit_changes", { kind: "done", hash: "a".repeat(40), left_out: [".env"] });
  await client.commit_changes();
  assert.deepEqual(
    calls.filter((call) => call.name === "git:commit_changes").map((call) => call.args),
    [[{ chat_id: "c1", project_path: "D:/project" }, "Add the parser"]],
  );
  assert.equal(actions().commit.message, "");
  assert.match(shown("CommitBox", { view: changed }), /Write messageLeft out: \.env$/);
});

test("failures stay in the box: a failed write, a missing identity with its command, a hook with its output", async () => {
  answers.set("git:write_message", { kind: "failed", error: "rate limited" });
  await client.write_commit_message();
  assert.match(shown("CommitBox", { view: changed }), /Writing failed: rate limited$/);
  client.set_commit_message("D:/project", "Fix it");
  answers.set("git:commit_changes", { kind: "identity" });
  await client.commit_changes();
  const text = shown("CommitBox", { view: changed });
  assert.match(text, /Git does not know your name and email yet/);
  assert.deepEqual(container.matching((element) => element.nodeName === "CODE").map((element) => element.textContent), ['git config --global user.email "you@example.com"']);
  answers.set("git:commit_changes", { kind: "hook", output: "line one\nline two\nline three\nline four" });
  await client.commit_changes();
  assert.match(shown("CommitBox", { view: changed }), /A hook rejected itline one\nline two\nline three$/);
  assert.equal(actions().commit.message, "Fix it");
});

test("the commit button counts only the files the commit takes, without left-out secret files and nested repositories", async () => {
  client.set_commit_message("D:/project", "Fix it");
  const mixed = repo({
    entries: [
      entry("a.ts", "modified"),
      entry(".env.local", "untracked"),
      entry("id_rsa", "added", { staged: true, unstaged: false }),
      entry("inner/", "untracked", { nested_repo: true }),
      entry("config/.env.example", "untracked"),
    ],
  });
  assert.match(shown("CommitBox", { view: mixed }), /Commit 2 files$/);
  const folder = repo({
    repo: { root: "D:/project/secrets.d", prefix: "secrets.d", worktree_of: null, superproject: null, shallow: false },
    entries: [entry("secrets.d/a.ts", "untracked"), entry("secrets.d/.env", "untracked")],
  });
  assert.match(shown("CommitBox", { view: folder }), /Commit 1 file$/);
});

test("the commit button is disabled with the reason, the hooks line is only a note", async () => {
  client.set_commit_message("D:/project", "Fix it");
  client.chats_store.update((state: any) => ({ ...state, list: state.list.map((chat: any) => ({ ...chat, streaming: true })) }));
  assert.match(shown("CommitBox", { view: changed }), /Turn running$/);
  assert.equal(button_named("Commit 2 files")?.getAttribute("disabled"), "");
  client.chats_store.update((state: any) => ({ ...state, list: state.list.map((chat: any) => ({ ...chat, streaming: false })) }));
  assert.match(shown("CommitBox", { view: { ...changed, operation: { kind: "rebase", step: 1, total: 2, branch: "feature" } } }), /Finish the running operation first$/);
  assert.match(shown("CommitBox", { view: { ...changed, entries: [entry("a.ts", "conflicted", { conflict: "UU" })] } }), /Resolve conflicts first$/);
  client.git_actions_store.update((state: any) => ({ roots: { "D:/project": { ...state.roots["D:/project"], guard: { hooks_off: true, commit_block: [], push_block: [] } } } }));
  assert.match(shown("CommitBox", { view: changed }), /Commit 2 filesThe repository's hooks do not run here$/);
  assert.equal(button_named("Commit 2 files")?.getAttribute("disabled"), null);
  client.git_actions_store.update((state: any) => ({ roots: { "D:/project": { ...state.roots["D:/project"], guard: { hooks_off: true, commit_block: ["filter.lfs"], push_block: ["filter.lfs"] } } } }));
  assert.match(shown("CommitBox", { view: changed }), /Repository configuration starts programs \(filter\.lfs\), use a terminal$/);
  assert.equal(button_named("Commit 2 files")?.getAttribute("disabled"), "");
});

test("Push shows for unpushed commits or a branch without upstream, Create PR only off the default branch without an open pull request", () => {
  assert.equal(shown("GitActions", { view: changed }), "PushCreate PR");
  assert.equal(shown("GitActions", { view: repo({}, { name: "feature", upstream: "origin/feature", ahead: 0 }) }), "Create PR");
  assert.equal(shown("GitActions", { view: repo({}, { name: "feature", upstream: null, ahead: null, behind: null }) }), "PushCreate PR");
  assert.equal(shown("GitActions", { view: repo({}, { name: "main", upstream: "origin/main", ahead: 0 }) }), "");
  assert.equal(shown("GitActions", { view: repo({ remotes: [], primary_remote: null }, { name: "feature", upstream: null, ahead: null, behind: null }) }), "");
  emit_github(data({ pr: { number: 15, title: "x", state: "open", html_url: null, reviews: null } }));
  assert.equal(shown("GitActions", { view: changed }), "Push");
  emit_github(data({ pr: { number: 15, title: "x", state: "merged", html_url: null, reviews: null } }));
  assert.equal(shown("GitActions", { view: changed }), "PushCreate PR");
  assert.equal(shown("GitActions", { view: { ...changed, operation: { kind: "merge", step: null, total: null, branch: null } } }), "");
});

test("a push failure shows under the action row with its copy command and goes away with the next push", async () => {
  answers.set("git:push", { kind: "error", error: { kind: "auth_required", remote: "origin", host: "github.com", detail: "x", command: "git push origin HEAD:feature" } });
  await client.push_branch();
  assert.match(shown("GitActions", { view: changed }), /^PushCreate PRGit has no credentials for github\.comgit push origin HEAD:feature$/);
  answers.set("git:push", { kind: "rejected", remote: "origin" });
  await client.push_branch();
  assert.match(shown("GitActions", { view: changed }), /Push rejected: origin has commits you don't have yet$/);
  answers.set("git:push", { kind: "done", remote: "origin", branch: "feature" });
  await client.push_branch();
  assert.equal(shown("GitActions", { view: changed }), "PushCreate PR");
});

test("the pull request composer opens with the written text, Create sends it and closes it", async () => {
  answers.set("github:write_pr", { kind: "text", title: "Add the parser", body: "Body", base: "main", push_first: 2 });
  await client.open_pr();
  assert.deepEqual([draft().open, draft().title, draft().body, draft().base, draft().push_first], [true, "Add the parser", "Body", "main", 2]);
  assert.match(shown("PrComposer"), /^Pull requestinto main.*Pushes 2 commits to origin firstCancelCreate$/s);
  client.set_pr_text("D:/project", { title: "Add the parser now" });
  answers.set("github:create_pr", { kind: "done", url: "https://github.com/7teb/VantheaX/pull/3", number: 3 });
  await client.create_pr();
  assert.deepEqual(calls.find((call) => call.name === "github:create_pr")?.args[1], { title: "Add the parser now", body: "Body", base: "main" });
  assert.equal(draft().open, false);
  assert.equal(shown("PrComposer"), "");
});

test("the composer shows the sign-in row, an existing pull request and a failed push, and closes when the branch changes", async () => {
  answers.set("github:write_pr", { kind: "cli", cli: { state: "signed_out", version: null }, command: "gh auth login" });
  await client.open_pr();
  assert.match(shown("PrComposer"), /GitHub CLI not signed in for github\.comgh auth login/);
  answers.set("github:write_pr", { kind: "text", title: "T", body: "B", base: "main", push_first: null });
  await client.open_pr();
  answers.set("github:create_pr", { kind: "exists", url: "https://github.com/7teb/VantheaX/pull/9" });
  await client.create_pr();
  assert.match(shown("PrComposer"), /A pull request for this branch exists alreadyOpen on GitHub/);
  answers.set("github:create_pr", { kind: "push", result: { kind: "rejected", remote: "origin" } });
  await client.create_pr();
  assert.match(shown("PrComposer"), /Push rejected: origin has commits you don't have yet/);
  emit_view(repo({ entries: changed.kind === "repo" ? changed.entries : [] }, { name: "other", upstream: "origin/other", ahead: 1 }));
  assert.equal(draft().open, false);
});

test("a branch switch clears the commit box and the push notice", async () => {
  client.set_commit_message("D:/project", "Half written");
  answers.set("git:push", { kind: "rejected", remote: "origin" });
  await client.push_branch();
  assert.equal(actions().commit.message, "Half written");
  emit_view(repo({}, { name: "other", upstream: "origin/other", ahead: 1 }));
  assert.equal(actions().commit.message, "");
  assert.equal(actions().push_issue, null);
});
