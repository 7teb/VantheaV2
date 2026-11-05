import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { build, type Plugin } from "esbuild";
import { git, repo_with, scratch, skip_without_git, write } from "./git-kit.ts";

let ipc: any;

const stub_path = path.resolve("tests/git-ipc-stub.ts");

const stubs: Plugin = {
  name: "git-ipc-stubs",
  setup: (build_api) => {
    build_api.onResolve({ filter: /^electron$|[\/]app[\/]window\.ts$|[\/]project[\/]files-root\.ts$/ }, () => ({ path: stub_path }));
  },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
  const entry = [
    'export { register_git_ipc } from "./electron/ipc/git.ts";',
    'export { git_service, init_git } from "./electron/git/index.ts";',
    'export { handlers, sent, trusted_event } from "./tests/git-ipc-stub.ts";',
  ].join("\n");
  const result = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [stubs] });
  const bundle = path.join(await scratch("ipc-bundle"), "git-ipc.mjs");
  await fs.writeFile(bundle, result.outputFiles[0].contents);
  ipc = await import(pathToFileURL(bundle).href);
  ipc.init_git({ turn_roots: async () => [], agent_roots: () => [], background_roots: () => [] });
  ipc.register_git_ipc();
});

after(() => ipc?.git_service.stop());

const refresh = (scope: unknown, event: unknown = ipc.trusted_event) => ipc.handlers.get("git:refresh")(event, scope);

const changes_for = (root: string) => ipc.sent.filter(([name, payload]: [string, { root: string }]) => name === "git:changed" && payload.root === root);

test("git:refresh without a running session is refused", async () => {
  const root = await scratch("ipc-none");
  await assert.rejects(refresh({ chat_id: null, project_path: root }), /no git session is running/);
});

test("git:refresh for another folder than the bound session is refused, the bound folder is accepted", async () => {
  const bound = await scratch("ipc-bound");
  const other = await scratch("ipc-other");
  ipc.git_service.bind({ path: bound, name: "bound", kind: "project" });
  await assert.rejects(refresh({ chat_id: "chat-b", project_path: other }), /git session is bound to another folder/);
  await refresh({ chat_id: "chat-a", project_path: bound.toUpperCase().replaceAll("\\", "/") });
  await assert.rejects(refresh({ chat_id: "chat-a", project_path: 42 }), /files scope must be an object/);
  await assert.rejects(refresh({ chat_id: null, project_path: bound }, { sender: {}, senderFrame: {} }), /untrusted sender/);
});

test("the session state goes out as git:changed and binding the same folder again sends it again at once", async () => {
  const root = await scratch("ipc-changed");
  ipc.git_service.bind({ path: root, name: "changed", kind: "project" });
  for (let waited = 0; waited < 10_000 && changes_for(root).length === 0; waited += 50) await sleep(50);
  const first = changes_for(root);
  assert.ok(first.length > 0);
  ipc.git_service.bind({ path: root, name: "changed", kind: "project" });
  const again = changes_for(root);
  assert.equal(again.length, first.length + 1);
  assert.deepEqual(again.at(-1), first.at(-1));
});

test("git:diff and git:line_counts only read a path the bound session's status lists", { skip: skip_without_git }, async () => {
  const root = await repo_with("ipc-diff", { "a.txt": "a\n", "b.txt": "b\n" });
  await write(root, { "a.txt": "A\n" });
  ipc.git_service.bind({ path: root, name: "ipc-diff", kind: "project" });
  const repo_shown = () => changes_for(root).some(([, payload]: [string, { view: { kind: string } }]) => payload.view.kind === "repo");
  for (let waited = 0; waited < 10_000 && !repo_shown(); waited += 50) await sleep(50);
  const scope = { chat_id: null, project_path: root };
  const diff = (file: unknown, at: unknown = scope) => ipc.handlers.get("git:diff")(ipc.trusted_event, at, file);
  assert.equal((await diff("a.txt")).kind, "text");
  await assert.rejects(diff("b.txt"), /b\.txt is not a changed file/);
  await assert.rejects(diff("../a.txt"), /is not a changed file/);
  await assert.rejects(diff(42), /file path must be a string/);
  await assert.rejects(diff("x".repeat(4001)), /longer than 4000 characters/);
  await assert.rejects(diff("a.txt", { chat_id: null, project_path: await scratch("ipc-diff-other") }), /git session is bound to another folder/);
  assert.deepEqual(await ipc.handlers.get("git:line_counts")(ipc.trusted_event, scope), [{ path: "a.txt", added: 1, removed: 1 }]);
});

test("git:commit and git:commit_diff take only a hex hash and only a path from that commit's file list", { skip: skip_without_git }, async () => {
  const root = await repo_with("ipc-commit", { "a.txt": "a\n", "b.txt": "b\n" });
  await write(root, { "a.txt": "A\n" });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "change a");
  const hash = git(root, "rev-parse", "HEAD").trim();
  ipc.git_service.bind({ path: root, name: "ipc-commit", kind: "project" });
  const repo_shown = () => changes_for(root).some(([, payload]: [string, { view: { kind: string } }]) => payload.view.kind === "repo");
  for (let waited = 0; waited < 10_000 && !repo_shown(); waited += 50) await sleep(50);
  const scope = { chat_id: null, project_path: root };
  const commit = (value: unknown, at: unknown = scope) => ipc.handlers.get("git:commit")(ipc.trusted_event, at, value);
  const commit_diff = (value: unknown, file: unknown) => ipc.handlers.get("git:commit_diff")(ipc.trusted_event, scope, value, file);
  assert.deepEqual((await commit(hash)).files.map((file: { path: string }) => file.path), ["a.txt"]);
  assert.equal((await commit_diff(hash.slice(0, 7), "a.txt")).kind, "text");
  await assert.rejects(commit_diff(hash, "b.txt"), /b\.txt is not a file of commit/);
  await assert.rejects(commit_diff(hash, "../a.txt"), /is not a file of commit/);
  await assert.rejects(commit_diff(hash, 7), /file path must be a string/);
  for (const bad of ["HEAD", "abc12", hash.toUpperCase(), `${hash}0`.padEnd(65, "0"), "--all", "abcdefg"]) {
    await assert.rejects(commit(bad), /commit hash must be|longer than 64 characters/, bad);
  }
  await assert.rejects(commit(42), /commit hash must be a string/);
  await assert.rejects(commit(hash, { chat_id: null, project_path: await scratch("ipc-commit-other") }), /git session is bound to another folder/);
});

test("git:history checks offset and fingerprint and git:history_close needs no session", { skip: skip_without_git }, async () => {
  const root = await repo_with("ipc-history", { "a.txt": "a\n" });
  ipc.git_service.bind({ path: root, name: "ipc-history", kind: "project" });
  const repo_shown = () => changes_for(root).some(([, payload]: [string, { view: { kind: string } }]) => payload.view.kind === "repo");
  for (let waited = 0; waited < 10_000 && !repo_shown(); waited += 50) await sleep(50);
  const scope = { chat_id: null, project_path: root };
  const history = (request: unknown) => ipc.handlers.get("git:history")(ipc.trusted_event, scope, request);
  const page = await history({ fingerprint: null, offset: 0 });
  assert.equal(page.start, 0);
  assert.equal(page.rows.length, 1);
  assert.equal(page.done, true);
  await assert.rejects(history({ fingerprint: null, offset: -1 }), /offset must be a non-negative integer/);
  await assert.rejects(history({ fingerprint: null, offset: 1.5 }), /offset must be a non-negative integer/);
  await assert.rejects(history({ fingerprint: null, offset: "0" }), /offset must be a non-negative integer/);
  await assert.rejects(history({ fingerprint: "x".repeat(129), offset: 0 }), /fingerprint must be null or a string of at most 128 characters/);
  await assert.rejects(history({ fingerprint: 5, offset: 0 }), /fingerprint must be null/);
  await assert.rejects(history(null), /history request must be an object/);
  await ipc.handlers.get("git:history_close")(ipc.trusted_event);
  ipc.git_service.stop();
  await ipc.handlers.get("git:history_close")(ipc.trusted_event);
});
