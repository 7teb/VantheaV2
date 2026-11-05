import assert from "node:assert/strict";
import { test } from "node:test";
import type { FetchError, GitView } from "../shared/git-view.ts";
import type { FetchCause, Fetcher, FetchStatus } from "../electron/git/fetch.ts";
import type { GitGuard } from "../electron/git/guard.ts";
import type { RepoPaths } from "../electron/git/repo.ts";
import type { GitTool } from "../electron/git/run.ts";
import type { GitReaders } from "../electron/git/readers.ts";
import { create_git_session, slow_status_ms, type GitSession } from "../electron/git/session.ts";
import type { GitWatchKind } from "../electron/git/watch.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const tool: GitTool = { exe: "C:/Git/cmd/git.exe", version: "2.50.0", numbers: [2, 50, 0], local_env: [] };

const paths: RepoPaths = { top: "C:/proj", git_dir: "C:/proj/.git", common_dir: "C:/proj/.git", prefix: "", superproject: null, shallow: false };

const guard: GitGuard = { read_config: [], partial_clone: false, program_keys: [], remotes: new Map(), ssh: { command: null, variant: null }, trees: [] };

const head = "a".repeat(40);

const status_text = (file: string) => `# branch.oid ${head}\0# branch.head main\0? ${file}\0`;

type Deferred = { resolve: (value: Buffer) => void; signal: AbortSignal };

const fake_fetcher = () => {
  const requests: FetchCause[] = [];
  const listeners = new Set<(key: string) => void>();
  const state = { status: { at: null, running: false, error: null, paused: false, queued: false } as FetchStatus, shutdowns: 0 };
  const fetcher: Fetcher = {
    status: () => state.status,
    request: (_target, cause) => requests.push(cause),
    request_head: () => undefined,
    next_tick: () => null,
    on_change: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    shutdown: () => {
      state.shutdowns += 1;
    },
  };
  return { fetcher, requests, state, listeners, change: (key: string) => [...listeners].forEach((listener) => listener(key)) };
};

const harness = (overrides: Partial<GitReaders> = {}) => {
  const fetch = fake_fetcher();
  const calls = { tool: 0, detect: 0, guard: 0, checks: 0, status: 0, refs: 0, remotes: 0, watch: 0 };
  const views: GitView[] = [];
  const state = { status: status_text("a.txt"), hold: false, held: [] as Deferred[], registry: [] as boolean[], dot_git: "dir" as "file" | "dir" | null, on_kinds: (_kinds: GitWatchKind[]) => {}, on_error: () => {}, focus: () => {} };
  const readers: GitReaders = {
    tool: async (_needed, registry) => {
      calls.tool += 1;
      state.registry.push(registry);
      return { kind: "found", tool, stamp: null };
    },
    location: async () => ({ work_tree: "C:/proj", git_dir: "C:/proj/.git", common_dir: "C:/proj/.git", dot_git: "dir" }),
    detect: async () => {
      calls.detect += 1;
      return { kind: "repo", paths };
    },
    guard: async (_tool, _paths, previous) => {
      if (previous) {
        calls.checks += 1;
        return previous;
      }
      calls.guard += 1;
      return guard;
    },
    status: (_tool, _root, _config, signal) => {
      calls.status += 1;
      if (!state.hold) return Promise.resolve(Buffer.from(state.status));
      return new Promise((resolve) => state.held.push({ resolve, signal }));
    },
    operation: async () => null,
    refs: async () => {
      calls.refs += 1;
      return { raw: Buffer.from(`refs/heads/main\0${head}\n`), refs: [], fetch_head: null };
    },
    remotes: async () => {
      calls.remotes += 1;
      return { raw: Buffer.from(""), remotes: [] };
    },
    watch: (_dirs, on_kinds, on_error) => {
      calls.watch += 1;
      state.on_kinds = on_kinds;
      state.on_error = on_error;
      return { close: () => undefined };
    },
    entry_kind: async () => state.dot_git,
    ...overrides,
  };
  const session: GitSession = create_git_session(
    { path: "C:/proj", name: "proj", kind: "project" },
    {
      readers,
      publish: (_root, view) => views.push(view),
      window: {
        on_focus: (listener) => {
          const before = state.focus;
          state.focus = () => {
            before();
            listener();
          };
          return () => undefined;
        },
        on_blur: () => () => undefined,
        focused: () => true,
      },
      fetcher: fetch.fetcher,
    },
  );
  const settled = async () => {
    for (let round = 0; round < 40; round += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  return { calls, views, state, session, settled, fetch, repo_views: () => views.filter((view) => view.kind === "repo") };
};

test("the first read publishes loading and then the repository", async () => {
  const run = harness();
  await run.settled();
  assert.deepEqual(run.views.map((view) => view.kind), ["loading", "repo"]);
  assert.deepEqual(run.calls, { tool: 1, detect: 1, guard: 1, checks: 0, status: 1, refs: 1, remotes: 1, watch: 1 });
  run.session.stop();
});

test("a second trigger while a status runs gives exactly one follow-up run", async () => {
  const run = harness();
  await run.settled();
  run.state.hold = true;
  run.state.on_kinds(["status"]);
  await run.settled();
  assert.equal(run.calls.status, 2);
  run.state.on_kinds(["status"]);
  run.state.on_kinds(["status"]);
  run.state.on_kinds(["status"]);
  await run.settled();
  assert.equal(run.calls.status, 2);
  run.state.held.shift()?.resolve(Buffer.from(run.state.status));
  await run.settled();
  assert.equal(run.calls.status, 3);
  run.state.held.shift()?.resolve(Buffer.from(run.state.status));
  await run.settled();
  assert.equal(run.calls.status, 3);
  run.session.stop();
});

test("a view is sent only when the raw output changed", async () => {
  const run = harness();
  await run.settled();
  const sent = run.views.length;
  run.state.on_kinds(["status", "refs"]);
  await run.settled();
  assert.equal(run.views.length, sent);
  run.state.status = status_text("b.txt");
  run.state.on_kinds(["status"]);
  await run.settled();
  assert.equal(run.views.length, sent + 1);
  const last = run.views.at(-1);
  assert.deepEqual(last?.kind === "repo" ? last.entries.map((entry) => entry.path) : [], ["b.txt"]);
  run.session.stop();
});

test("stopping aborts running reads and sends nothing afterwards", async () => {
  const run = harness();
  await run.settled();
  run.state.hold = true;
  run.state.on_kinds(["status"]);
  await run.settled();
  const held = run.state.held.shift();
  assert.equal(held?.signal.aborted, false);
  const sent = run.views.length;
  run.session.stop();
  assert.equal(held?.signal.aborted, true);
  run.state.status = status_text("c.txt");
  held?.resolve(Buffer.from(run.state.status));
  run.state.on_kinds(["status"]);
  await run.settled();
  assert.equal(run.views.length, sent);
});

test("republishing for another chat in the same folder sends the state again without reading", async () => {
  const run = harness();
  await run.settled();
  const before = { ...run.calls };
  const sent = run.views.length;
  run.session.republish();
  assert.equal(run.views.length, sent + 1);
  assert.deepEqual(run.views.at(-1), run.views.at(-2));
  await run.settled();
  assert.deepEqual(run.calls, before);
  run.session.stop();
});

test("focus detects and reads status and refs, the .git path detects fully", async () => {
  const run = harness();
  await run.settled();
  run.state.focus();
  await run.settled();
  assert.deepEqual(
    { detect: run.calls.detect, guard: run.calls.guard, checks: run.calls.checks, status: run.calls.status, refs: run.calls.refs, remotes: run.calls.remotes },
    { detect: 2, guard: 1, checks: 1, status: 2, refs: 2, remotes: 1 },
  );
  run.session.tree_event("rename", ".git");
  await sleep(400);
  assert.deepEqual({ detect: run.calls.detect, guard: run.calls.guard, remotes: run.calls.remotes }, { detect: 3, guard: 2, remotes: 2 });
  assert.deepEqual(run.state.registry, [true, false, true]);
  run.session.stop();
});

test("a change event on a .git folder is a write inside it, on a .git file it may point elsewhere", async () => {
  const run = harness();
  await run.settled();
  run.session.tree_event("change", ".git");
  await sleep(400);
  assert.deepEqual({ detect: run.calls.detect, status: run.calls.status }, { detect: 1, status: 1 });
  run.state.dot_git = "file";
  run.session.tree_event("change", ".git");
  await sleep(400);
  assert.equal(run.calls.detect, 2);
  run.session.stop();
});

test("a config change reads remotes and checks the guard before the next status", async () => {
  const run = harness();
  await run.settled();
  run.state.on_kinds(["status", "remotes"]);
  await run.settled();
  assert.deepEqual(
    { guard: run.calls.guard, checks: run.calls.checks, status: run.calls.status, remotes: run.calls.remotes, detect: run.calls.detect },
    { guard: 1, checks: 1, status: 2, remotes: 2, detect: 1 },
  );
  run.session.stop();
});

test("a slow status marks the view as refreshing and clears it when done", async () => {
  const run = harness();
  await run.settled();
  run.state.hold = true;
  run.state.on_kinds(["status"]);
  await sleep(slow_status_ms + 150);
  assert.equal(run.repo_views().at(-1)?.kind === "repo" && run.repo_views().at(-1)?.refreshing, true);
  run.state.held.shift()?.resolve(Buffer.from(run.state.status));
  await run.settled();
  const last = run.repo_views().at(-1);
  assert.equal(last?.kind === "repo" ? last.refreshing : true, false);
  run.session.stop();
});

test("a failed watcher is reported once, triggers a full read and is not started again", async () => {
  const run = harness();
  await run.settled();
  run.state.on_error();
  run.state.on_error();
  await run.settled();
  const last = run.repo_views().at(-1);
  assert.equal(last?.kind === "repo" ? last.watch_failed : false, true);
  assert.equal(run.calls.detect, 2);
  assert.equal(run.calls.watch, 1);
  run.session.stop();
});

test("a status failure shows git's line and the next good read clears it", async () => {
  let fail = false;
  const run = harness({
    status: async () => {
      if (fail) throw Object.assign(new Error("git status exited with 128"), { git_line: "fatal: index file corrupt" });
      return Buffer.from(status_text("a.txt"));
    },
  });
  await run.settled();
  fail = true;
  run.state.on_kinds(["status"]);
  await run.settled();
  assert.deepEqual(run.views.at(-1), { kind: "error", message: "fatal: index file corrupt", broken_gitfile: false });
  fail = false;
  run.state.on_kinds(["status"]);
  await run.settled();
  assert.equal(run.views.at(-1)?.kind, "repo");
  run.session.stop();
});

test("without git a folder inside a repository says git is missing, any other folder shows nothing", async () => {
  const missing = harness({ tool: async () => ({ kind: "missing" }) });
  await missing.settled();
  assert.deepEqual(missing.views.at(-1), { kind: "git_missing" });
  missing.session.stop();
  const plain = harness({ tool: async () => ({ kind: "missing" }), location: async () => null });
  await plain.settled();
  assert.deepEqual(plain.views, [{ kind: "none" }]);
  plain.session.stop();
  const old = harness({ tool: async () => ({ kind: "found", tool: { ...tool, version: "2.30.1", numbers: [2, 30, 1] }, stamp: null }) });
  await old.settled();
  assert.deepEqual(old.views.at(-1), { kind: "git_too_old", version: "2.30.1", reason: "minimum" });
  old.session.stop();
});

test("every status read checks the guard first and uses the configuration it returns", async () => {
  const configs: string[] = [];
  let stale = false;
  const run = harness({
    guard: async (_tool, _paths, previous) => (previous && !stale ? previous : { ...guard, read_config: stale ? [["core.fsmonitor", "false"]] : [] }),
    status: async (_tool, _root, config) => {
      configs.push(JSON.stringify(config));
      return Buffer.from(status_text("a.txt"));
    },
  });
  await run.settled();
  stale = true;
  run.state.on_kinds(["status"]);
  await run.settled();
  assert.deepEqual(configs, ["[]", '[["core.fsmonitor","false"]]']);
  run.session.stop();
});

const with_origin: Partial<GitReaders> = {
  remotes: async () => ({ raw: Buffer.from("origin git@github.com:o/r.git"), remotes:[{ name: "origin", url: "git@github.com:o/r.git", host: "github.com", host_kind: "github", slug: "o/r" }] }),
};

test("the first repository view asks for the opening fetch once, focus and refresh ask again", async () => {
  const run = harness(with_origin);
  await run.settled();
  run.session.republish();
  await run.settled();
  assert.deepEqual(run.fetch.requests, ["open"]);
  run.state.focus();
  run.session.refresh();
  await run.settled();
  assert.deepEqual(run.fetch.requests, ["open", "focus", "refresh"]);
  run.session.stop();
});

test("a repository without a remote never asks for a fetch", async () => {
  const run = harness();
  await run.settled();
  run.state.focus();
  run.session.refresh();
  await run.settled();
  assert.deepEqual(run.fetch.requests, []);
  run.session.stop();
});

test("the fetch state of the primary remote is part of the view and a fetcher change sends it again", async () => {
  const run = harness(with_origin);
  await run.settled();
  const sent = run.views.length;
  run.fetch.change("c:/proj/.git");
  assert.equal(run.views.length, sent);
  const error: FetchError = { kind: "auth_required", remote: "origin", host: "github.com", detail: "fatal: could not read Username", command: "git fetch origin" };
  run.fetch.state.status = { at: null, running: false, error, paused: true, queued: true };
  run.fetch.change("c:/other/.git");
  assert.equal(run.views.length, sent);
  run.fetch.change("c:/proj/.git");
  const last = run.views.at(-1);
  assert.deepEqual(last?.kind === "repo" ? last.fetch : null, { at: null, running: false, error, blocked: { kind: "agent_running" }, queued: true });
  run.session.stop();
});

test("stopping the session unsubscribes from the fetcher and leaves a running fetch alone", async () => {
  const run = harness(with_origin);
  await run.settled();
  assert.equal(run.fetch.listeners.size, 1);
  run.session.stop();
  assert.equal(run.fetch.listeners.size, 0);
  assert.equal(run.fetch.state.shutdowns, 0);
});
