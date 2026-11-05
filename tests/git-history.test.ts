import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";
import type { GitRepoView, GraphRow, HistoryPage } from "../shared/git-view.ts";
import { empty_lanes, lay_out } from "../shared/git/graph.ts";
import { create_commit_reader } from "../electron/git/commit.ts";
import type { GitReadAccess } from "../electron/git/diff.ts";
import { create_history, history_page_size, ref_labels, type GitHistory } from "../electron/git/history.ts";
import { read_refs, type GitRef } from "../electron/git/refs.ts";
import { git, repo_with, scratch, skip_without_git, tool } from "./git-kit.ts";
import { repo } from "./git-view-kit.ts";

const options = { skip: skip_without_git };

type Spec = { branch: string; parents: number[]; message: string };

const import_history = (root: string, specs: Spec[], tags: [name: string, mark: number][] = []) => {
  const parts: string[] = [];
  for (const [index, spec] of specs.entries()) {
    const message = Buffer.from(spec.message, "utf8");
    parts.push(`commit refs/heads/${spec.branch}`, `mark :${index + 1}`, `committer VantheaX Test <test@example.invalid> ${1_700_000_000 + index} +0000`, `data ${message.length}`, spec.message);
    const [first, ...rest] = spec.parents;
    if (first !== undefined) parts.push(`from :${first}`);
    for (const parent of rest) parts.push(`merge :${parent}`);
    parts.push("");
  }
  for (const [name, mark] of tags) parts.push(`reset refs/tags/${name}`, `from :${mark}`, "");
  execFileSync(tool().exe, ["fast-import", "--quiet"], { cwd: root, input: `${parts.join("\n")}\n` });
};

const long_history = async (prefix: string, count: number): Promise<string> => {
  const root = await scratch(prefix);
  git(root, "init", "-q", "-b", "main");
  const padding = "x".repeat(160);
  const specs: Spec[] = [];
  for (let index = 0; index < count; index += 1) {
    specs.push({ branch: "main", parents: index === 0 ? [] : [index], message: `commit ${index} ${padding}` });
  }
  specs.push({ branch: "side", parents: [count - 5], message: "side work" });
  specs.push({ branch: "main", parents: [count, count + 1], message: "merge side" });
  import_history(root, specs, [["v1", 10]]);
  git(root, "checkout", "-q", "main");
  return root;
};

const access_of = async (root: string, fingerprint: string, extra: Partial<GitRepoView["repo"]> = {}, signal = new AbortController().signal): Promise<GitReadAccess> => {
  const refs = await read_refs(tool(), root, `${root}/.git`, []);
  const head = git(root, "rev-parse", "HEAD").trim();
  const view: GitRepoView = { ...repo({ head, fingerprint }), repo: { root, prefix: "", worktree_of: null, superproject: null, shallow: false, ...extra } };
  return { tool: tool(), root, config: [], view, refs: refs.refs, signal };
};

const source_of = (access: GitReadAccess) => ({ view: () => access.view, access: async () => access });

const all_pages = async (history: GitHistory, access: GitReadAccess): Promise<HistoryPage[]> => {
  const pages: HistoryPage[] = [];
  let offset = 0;
  for (;;) {
    const page = await history.page(source_of(access), { fingerprint: pages.length === 0 ? null : access.view.fingerprint, offset });
    pages.push(page);
    offset += page.rows.length;
    if (page.done) return pages;
  }
};

const rev_list = (root: string): string[] => git(root, "rev-list", "--topo-order", "--branches", "--remotes", "--tags", "HEAD").trim().split("\n");

const without_labels = (rows: GraphRow[]) => rows.map(({ labels: _labels, ...row }) => row);

const git_children = (expected: number): number => {
  const count = `@(Get-CimInstance Win32_Process -Filter "ParentProcessId=${process.pid} AND Name='git.exe'").Count`;
  const script = `$deadline = (Get-Date).AddSeconds(15); do { $count = ${count}; if ($count -eq ${expected}) { break }; Start-Sleep -Milliseconds 100 } while ((Get-Date) -lt $deadline); $count`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  return Number(result.stdout.trim());
};

test("pages come out of one paused rev-list in topological order and lay out like the whole history", options, async () => {
  const root = await long_history("history-pages", 3000);
  const access = await access_of(root, "f1");
  const history = create_history();
  const pages = await all_pages(history, access);
  history.close();
  assert.deepEqual(
    pages.map((page) => page.start),
    pages.map((_page, index) => index * history_page_size),
  );
  assert.deepEqual(
    pages.map((page) => page.done),
    pages.map((_page, index) => index === pages.length - 1),
  );
  assert.ok(pages.every((page) => page.fingerprint === "f1" && !page.shallow_end));
  const rows = pages.flatMap((page) => page.rows);
  assert.deepEqual(
    rows.map((row) => row.hash),
    rev_list(root),
  );
  assert.deepEqual(without_labels(rows), without_labels(lay_out(rows.map(({ hash, parents, author, time, subject }) => ({ hash, parents, author, time, subject })), empty_lanes).rows as GraphRow[]));
  assert.equal(rows[0].subject, "merge side");
  assert.equal(rows[0].parents.length, 2);
  assert.equal(rows[0].author, "VantheaX Test");
  assert.equal(rows[0].time, (1_700_000_000 + 3001) * 1000);
  assert.deepEqual(rows[0].labels, [{ name: "main", kind: "head", worktree: null }]);
  assert.deepEqual(rows.find((row) => row.subject === "side work")?.labels, [{ name: "side", kind: "branch", worktree: null }]);
  assert.deepEqual(rows.find((row) => row.subject.startsWith("commit 9 "))?.labels, [{ name: "v1", kind: "tag", worktree: null }]);
});

test("a request with the current fingerprint and an offset continues at that offset after a restart", options, async () => {
  const root = await long_history("history-replay", 600);
  const access = await access_of(root, "f2");
  const first = create_history();
  const pages = await all_pages(first, access);
  first.close();
  const fresh = create_history();
  const second = await fresh.page(source_of(access), { fingerprint: "f2", offset: history_page_size });
  assert.equal(second.start, history_page_size);
  assert.deepEqual(second.rows, pages[1].rows);
  fresh.close();
  const reopened = await fresh.page(source_of(access), { fingerprint: "f2", offset: 2 * history_page_size });
  assert.equal(reopened.start, 2 * history_page_size);
  assert.deepEqual(reopened.rows, pages[2].rows);
  fresh.close();
});

test("another fingerprint starts over at the top with the new commit first", options, async () => {
  const root = await long_history("history-moved", 450);
  const history = create_history();
  const before = await access_of(root, "old");
  await history.page(source_of(before), { fingerprint: null, offset: 0 });
  git(root, "-c", "user.name=VantheaX Test", "-c", "user.email=test@example.invalid", "commit", "-q", "--allow-empty", "-m", "newest");
  const after = await access_of(root, "new");
  const page = await history.page(source_of(after), { fingerprint: "old", offset: history_page_size });
  assert.equal(page.start, 0);
  assert.equal(page.fingerprint, "new");
  assert.equal(page.rows[0].subject, "newest");
  history.close();
});

test("closing the history ends its rev-list process, and retiring the fingerprint closes it too", options, async () => {
  const root = await long_history("history-close", 3000);
  const access = await access_of(root, "f3");
  const history = create_history();
  await history.page(source_of(access), { fingerprint: null, offset: 0 });
  assert.equal(git_children(1), 1, "the paused rev-list keeps running after the first page");
  history.close();
  assert.equal(git_children(0), 0, "the rev-list process ends after close");
  await history.page(source_of(access), { fingerprint: "f3", offset: 0 });
  history.retire("f3");
  assert.equal(git_children(1), 1, "the same fingerprint keeps the stream");
  history.retire("other");
  assert.equal(git_children(0), 0, "the rev-list process ends after retire");
});

test("aborting the session signal ends the paused rev-list and fails the next read", options, async () => {
  const root = await long_history("history-abort", 3000);
  const controller = new AbortController();
  const access = await access_of(root, "f4", {}, controller.signal);
  const history = create_history();
  await history.page(source_of(access), { fingerprint: null, offset: 0 });
  controller.abort(new Error("session stopped"));
  assert.equal(git_children(0), 0, "the rev-list process ends after the abort");
  await assert.rejects(history.page({ view: () => access.view, access: async () => Promise.reject(new Error("no session")) }, { fingerprint: "f4", offset: 200 }), /was closed|no session/);
  history.close();
});

test("a shallow clone ends with shallow_end and its boundary commit has no parents", options, async () => {
  const origin = await long_history("history-origin", 20);
  const root = await scratch("history-shallow");
  git(root, "clone", "-q", "--depth", "3", "--no-local", origin, ".");
  const access = await access_of(root, "f5", { shallow: true });
  const history = create_history();
  const [page] = await all_pages(history, access);
  history.close();
  assert.equal(page.done, true);
  assert.equal(page.shallow_end, true);
  assert.deepEqual(page.rows.at(-1)?.parents, []);
  assert.deepEqual(page.rows.at(-1)?.down, []);
});

test("a repository without commits has no history", options, async () => {
  const root = await scratch("history-unborn");
  git(root, "init", "-q", "-b", "main");
  const access: GitReadAccess = { tool: tool(), root, config: [], view: { ...repo({ head: null, fingerprint: "f6" }), repo: { root, prefix: "", worktree_of: null, superproject: null, shallow: false } }, refs: [], signal: new AbortController().signal };
  await assert.rejects(create_history().page(source_of(access), { fingerprint: null, offset: 0 }), /has no commits yet/);
});

test("a commit date a JS Date cannot hold, or no readable date, comes out as time null in the history and in the details", options, async () => {
  const root = await repo_with("history-dates", { "a.txt": "a\n" });
  const tree = git(root, "rev-parse", "HEAD^{tree}").trim();
  const commit_object = (parent: string, date: string, subject: string): string => {
    const body = `tree ${tree}\nparent ${parent}\nauthor A <a@example.invalid> ${date}\ncommitter A <a@example.invalid> 1700000000 +0000\n\n${subject}\n`;
    return execFileSync(tool().exe, ["hash-object", "-t", "commit", "-w", "--literally", "--stdin"], { cwd: root, input: body }).toString("utf8").trim();
  };
  const last = commit_object(git(root, "rev-parse", "HEAD").trim(), "8640000000000 +0000", "last date");
  const far = commit_object(last, "99999999999999 +0000", "far future");
  const broken = commit_object(far, "-5 +0000", "no date");
  git(root, "update-ref", "refs/heads/main", broken);
  const access = await access_of(root, "f7");
  const history = create_history();
  const [page] = await all_pages(history, access);
  history.close();
  assert.deepEqual(
    page.rows.map((row) => [row.subject, row.time]),
    [
      ["no date", null],
      ["far future", null],
      ["last date", 8_640_000_000_000_000],
      ["init", page.rows[3].time],
    ],
  );
  assert.equal(typeof page.rows[3].time, "number");
  const reader = create_commit_reader();
  assert.equal((await reader.detail(access, broken)).time, null);
  assert.equal((await reader.detail(access, far)).time, null);
  assert.equal((await reader.detail(access, last)).time, 8_640_000_000_000_000);
});

test("labels on one commit are ordered current branch, its upstream, local branches, remotes, tags; worktree only for branches checked out elsewhere", () => {
  const root = "D:/project";
  const ref = (name: string, kind: GitRef["kind"], extra: Partial<GitRef> = {}): GitRef => ({ name, kind, hash: "h", target: "h", upstream: null, track: null, head: false, worktree: null, ...extra });
  const labels = ref_labels(
    [
      ref("v1", "tag"),
      ref("origin/feature", "remote"),
      ref("origin/main", "remote"),
      ref("feature", "branch", { worktree: "D:/VantheaX-wt/feature" }),
      ref("main", "branch", { head: true, upstream: "origin/main", worktree: "d:\\Project\\" }),
      ref("zeta", "branch"),
    ],
    root,
  ).get("h");
  assert.deepEqual(labels, [
    { name: "main", kind: "head", worktree: null },
    { name: "origin/main", kind: "remote", worktree: null },
    { name: "feature", kind: "branch", worktree: "D:/VantheaX-wt/feature" },
    { name: "zeta", kind: "branch", worktree: null },
    { name: "origin/feature", kind: "remote", worktree: null },
    { name: "v1", kind: "tag", worktree: null },
  ]);
});
