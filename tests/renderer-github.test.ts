import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { GitView } from "../shared/git-view.ts";
import type { GithubData, GithubRepoView } from "../shared/github-view.ts";
import type { FilesRoot } from "../shared/ipc/files.ts";
import { bundle, install_dom, stub_components, type FakeElement, type Vx } from "./dom-kit.ts";
import { repo } from "./git-view-kit.ts";

const listeners = new Map<string, (payload: any) => void>();
const project: FilesRoot = { path: "D:/project", name: "project", kind: "project" };
const ref = { host: "github.com", owner: "7teb", name: "VantheaX" };
const head = "4276a37f0c1d2e3b4a5968778695a4b3c2d1e0f9";

const vx: Vx = {
  invoke: async (name) => {
    if (name === "files:root") return project;
    if (name === "files:list") return { path: "", entries: [], more: 0 };
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

const emit_git = (view: GitView) => listeners.get("git:changed")?.({ root: "D:/project", view });

const emit_github = (view: GithubRepoView) => listeners.get("github:repo_changed")?.({ root: "D:/project", view });

const card_text = () => {
  client.flushSync(() => root.render(client.createElement(client.GitCard)));
  return container.textContent;
};

const data = (extra: Partial<GithubData> = {}): GithubData => ({
  kind: "data",
  repo: ref,
  html_url: "https://github.com/7teb/VantheaX",
  default_branch: "main",
  visibility: "private",
  archived: false,
  fork_parent: null,
  renamed_from: null,
  branch: { kind: "same", sha: head },
  pr: null,
  checks: null,
  source: "gh",
  source_login: "octocat",
  updated_at: "2026-10-16T12:02:00.000Z",
  stale: null,
  ...extra,
});

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
      'export { github_store, github_view_of, init_github } from "./src/state/github.ts";',
      'export { open_chat } from "./src/state/ui.ts";',
      'export { translate } from "./src/i18n/translate.ts";',
      'export { GitCard } from "./src/features/docks/files/git/GitCard.tsx";',
      'export { branch_text } from "./src/features/docks/files/git/GithubPopover.tsx";',
      'export { duration_text } from "./src/features/docks/files/git/GithubChecks.tsx";',
    ],
    [stub_components("none", {})],
  );
  client.init_files();
  client.init_git();
  client.init_github();
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
  client.open_chat("c1", "D:/project");
  await client.sync_files();
  await settled();
  emit_git(repo({}, { ahead: 0 }));
});

after(() => {
  root?.unmount();
  restore();
});

test("without access the row names the repository and the one way in: the gh login or the GitHub CLI install", () => {
  emit_github({ kind: "needs_sign_in", repo: ref, reason: "not_readable", cli: { state: "signed_out", version: null }, command: "gh auth login" });
  assert.match(card_text(), /7teb\/VantheaXgh auth login$/);
  emit_github({ kind: "needs_sign_in", repo: ref, reason: "not_readable", cli: { state: "missing", version: null }, command: null });
  assert.match(card_text(), /7teb\/VantheaXPrivate repository or not foundDownload GitHub CLI$/);
  emit_github({ kind: "needs_sign_in", repo: ref, reason: "not_readable", cli: { state: "too_old", version: "2.40.1" }, command: null });
  assert.match(card_text(), /GitHub CLI 2\.40\.1 is too oldDownload GitHub CLI$/);
  emit_github({ kind: "no_access", repo: ref, login: "octocat", command: "gh auth login" });
  assert.match(card_text(), /7teb\/VantheaX is not visible to @octocatgh auth login$/);
  emit_github({ kind: "cli_host", repo: { host: "acme.ghe.com", owner: "acme", name: "tools" }, cli: { state: "signed_out", version: null }, command: "gh auth login --hostname acme.ghe.com" });
  assert.match(card_text(), /GitHub CLI not signed in for acme\.ghe\.comgh auth login --hostname acme\.ghe\.com$/);
  emit_github({ kind: "sso", repo: ref, org: "7teb", url: "https://github.com/orgs/7teb/sso" });
  assert.match(card_text(), /7teb requires single sign-onStart SSO session$/);
  emit_github({ kind: "unavailable", repo: ref, reason: "server_error", reset_at: null, status: 502, cli: null, command: null });
  assert.match(card_text(), /GitHub is not responding \(502\)$/);
});

test("data shows the repository with pull request and checks, stale data keeps them and adds its age", () => {
  const checks = { state: "running" as const, counts: { failed: 0, action_required: 0, running: 1, passed: 2, skipped: 0 }, items: [], limited: false };
  emit_github(data({ pr: { number: 15, title: "Show Initialize", state: "open", html_url: null, reviews: null }, checks }));
  assert.match(card_text(), /7teb\/VantheaX#15 Open1 running$/);
  emit_github(data({ stale: { reason: "offline", reset_at: null, status: null }, checks }));
  assert.match(card_text(), /7teb\/VantheaX·as of \d{2}:\d{2}( [AP]M)?·offline1 running$/);
});

test("a skeleton from a new session does not hide what is known about the same repository", () => {
  emit_github(data());
  emit_github({ kind: "loading", repo: ref });
  assert.equal(client.github_view_of(client.github_store.get(), "D:/project").kind, "data");
  emit_github({ kind: "loading", repo: { ...ref, name: "Other" } });
  assert.equal(client.github_view_of(client.github_store.get(), "D:/project").kind, "loading");
});

test("the rate limit without data offers the GitHub CLI login, or its download when gh is missing", () => {
  const limited = { kind: "unavailable" as const, repo: ref, reason: "rate_limited" as const, reset_at: "2026-10-16T15:00:00.000Z", status: null };
  emit_github({ ...limited, cli: { state: "signed_out", version: null }, command: "gh auth login" });
  assert.match(card_text(), /GitHub limit reachedgh auth login$/);
  emit_github({ ...limited, cli: { state: "missing", version: null }, command: null });
  assert.match(card_text(), /GitHub limit reachedResets at \d{2}:\d{2}( [AP]M)?Download GitHub CLI$/);
  emit_github({ ...limited, cli: null, command: null });
  assert.match(card_text(), /GitHub limit reachedResets at \d{2}:\d{2}( [AP]M)?$/);
});

test("the branch on GitHub reads from both directions", () => {
  const t = (key: string, vars?: Record<string, unknown>) => client.translate("en", key, vars);
  const same = { kind: "same", sha: head };
  assert.equal(client.branch_text(t, same, 0, head), "same as local");
  assert.equal(client.branch_text(t, same, 4, head), "4 local commits missing");
  assert.equal(client.branch_text(t, same, null, head), "same as local");
  assert.equal(client.branch_text(t, same, null, "9".repeat(40)), "differs from local");
  assert.equal(client.branch_text(t, { kind: "remote_ahead", count: 3 }, 2, head), "3 new commits, not fetched yet; 2 local missing");
  assert.equal(client.branch_text(t, { kind: "remote_ahead", count: 1 }, null, head), "1 new commit, not fetched yet");
  assert.equal(client.branch_text(t, { kind: "missing" }, null, head), "not pushed yet");
  assert.equal(client.branch_text(t, { kind: "none" }, 0, head), null);
});

test("check durations read in the interface language", () => {
  const en = (key: string, vars?: Record<string, unknown>) => client.translate("en", key, vars);
  const de = (key: string, vars?: Record<string, unknown>) => client.translate("de", key, vars);
  assert.equal(client.duration_text(en, 41_000), "41 s");
  assert.equal(client.duration_text(en, 72_000), "1 min 12 s");
  assert.equal(client.duration_text(de, 72_000), "1 Min. 12 s");
  assert.equal(client.duration_text(de, 120_000), "2 Min.");
  assert.equal(client.duration_text(de, 3_725_000), "1 Std. 2 Min.");
});
