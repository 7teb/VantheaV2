import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitWindow, RemoteHead } from "../electron/git/fetch.ts";
import type { GithubClient, TransportCall } from "../electron/github/client.ts";
import type { GhCache, GhStatus } from "../electron/github/gh-cli.ts";
import { create_repo_session, type GithubTarget, type RepoMemory, type RepoSession } from "../electron/github/repo-session.ts";
import type { GithubData, GithubRepoView } from "../shared/github-view.ts";
import { reply, routed_client, sha, type Route } from "./github-kit.ts";

const target: GithubTarget = {
  repo: { host: "github.com", owner: "7teb", name: "VantheaX" },
  host_kind: "github",
  remote: "origin",
  remote_url: "https://github.com/7teb/VantheaX.git",
  branch: "main",
  tracking: sha("a"),
};

const window: GitWindow = { on_focus: () => () => undefined, on_blur: () => () => undefined, focused: () => true };

const info = reply(200, { full_name: "7teb/VantheaX", visibility: "public", html_url: "https://github.com/7teb/VantheaX" });

const cache = (status: GhStatus) => {
  const reads = { rereads: 0, status, hosts: new Set<string>() };
  const gh: GhCache = {
    status: async (host) => {
      reads.hosts.add(host);
      return reads.status;
    },
    reread: async (host) => {
      reads.hosts.add(host);
      reads.rereads += 1;
      return reads.status;
    },
    exe: () => null,
  };
  return { gh, reads };
};

const wait_until = async (what: string, done: () => boolean) => {
  for (let waited = 0; !done(); waited += 5) {
    if (waited > 5000) throw new Error(`${what} did not happen`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

type Rig = { session: RepoSession; views: GithubRepoView[]; heads: RemoteHead[]; last: () => GithubRepoView | undefined };

type Reads = ReturnType<typeof cache>["reads"];

const start = (client: GithubClient, status: GhStatus, at: GithubTarget = target, memory: RepoMemory | null = null): Rig & { rereads: () => number; reads: Reads } => {
  const views: GithubRepoView[] = [];
  const heads: RemoteHead[] = [];
  const { gh, reads } = cache(status);
  const session = create_repo_session(at, { client, gh, window, publish: (view) => views.push(view), fetch_head: (head) => heads.push(head) }, memory);
  return { session, views, heads, last: () => views.at(-1), rereads: () => reads.rereads, reads };
};

const last_data = (rig: Rig): GithubData => {
  const view = rig.last();
  assert.equal(view?.kind, "data");
  return view as GithubData;
};

const public_routes = (head: string): Record<string, Route> => ({ "repos/7teb/VantheaX": info, "repos/7teb/VantheaX/branches/main": reply(200, { commit: { sha: head } }) });

test("a public repository shows a skeleton first, then its data from the anonymous API", async () => {
  const rig = start(routed_client(public_routes(sha("a"))), { kind: "missing" });
  try {
    assert.equal(rig.views[0]?.kind, "loading");
    await wait_until("the data", () => rig.last()?.kind === "data");
    const data = rig.last();
    assert.equal(data?.kind === "data" ? data.source : null, "anonymous");
    assert.deepEqual(data?.kind === "data" ? data.branch : null, { kind: "same", sha: sha("a") });
    assert.deepEqual(rig.heads, []);
  } finally {
    rig.session.stop();
  }
});

test("a head on GitHub that was not fetched yet asks for a fetch", async () => {
  const rig = start(routed_client(public_routes(sha("b"))), { kind: "missing" });
  try {
    await wait_until("the data", () => rig.last()?.kind === "data");
    assert.deepEqual(rig.heads, [{ branch: "main", sha: sha("b"), tracking: sha("a") }]);
  } finally {
    rig.session.stop();
  }
});

test("data stays readable when GitHub goes offline, without data the row says GitHub is unreachable", async () => {
  let online = true;
  const routes: Record<string, Route> = public_routes(sha("a"));
  const client = routed_client(routes);
  const flaky: GithubClient = { ...client, get: (request) => (online ? client.get(request) : Promise.resolve({ kind: "offline" })) };
  const rig = start(flaky, { kind: "missing" });
  try {
    await wait_until("the data", () => rig.last()?.kind === "data");
    online = false;
    rig.session.refresh();
    await wait_until("the stale data", () => {
      const view = rig.last();
      return view?.kind === "data" && view.stale !== null;
    });
    const stale = rig.last();
    assert.deepEqual(stale?.kind === "data" ? stale.stale : null, { reason: "offline", reset_at: null, status: null });
  } finally {
    rig.session.stop();
  }
  const cold = start({ ...client, get: async () => ({ kind: "offline" }) }, { kind: "missing" });
  try {
    await wait_until("the unavailable row", () => cold.last()?.kind === "unavailable");
    assert.deepEqual(cold.last(), { kind: "unavailable", repo: target.repo, reason: "offline", reset_at: null, status: null, cli: null, command: null });
  } finally {
    cold.session.stop();
  }
});

test("a private repository without a gh login asks for gh auth login and a refresh reads the gh login again", async () => {
  const rig = start(routed_client({}), { kind: "found", exe: "gh.exe", accounts: [] });
  try {
    await wait_until("the sign-in row", () => rig.last()?.kind === "needs_sign_in");
    assert.deepEqual(rig.last(), { kind: "needs_sign_in", repo: target.repo, reason: "not_readable", cli: { state: "signed_out", version: null }, command: "gh auth login" });
    rig.session.refresh();
    await wait_until("the second round", () => rig.rereads() === 1);
  } finally {
    rig.session.stop();
  }
});

test("a revoked gh token falls back to the anonymous API in the same round", async () => {
  const anonymous = public_routes(sha("a"));
  const gh_routes: Record<string, Route> = { "repos/7teb/VantheaX": info, "repos/7teb/VantheaX/branches/main": reply(401, { message: "Bad credentials" }) };
  const status: GhStatus = { kind: "found", exe: "gh.exe", accounts: [{ host: "github.com", login: "octo", active: true, state: "success" }] };
  const client = routed_client(anonymous, gh_routes);
  let gh_calls = 0;
  const counted: GithubClient = {
    ...client,
    get: (request) => {
      if (request.source.kind === "gh") gh_calls += 1;
      if (request.source.kind === "gh" && gh_calls > 2) return Promise.resolve({ kind: "unauthorized" });
      return client.get(request);
    },
  };
  const rig = start(counted, status);
  try {
    await wait_until("the data", () => rig.last()?.kind === "data");
    const data = rig.last();
    assert.equal(data?.kind === "data" ? data.source : null, "anonymous");
    assert.equal(rig.rereads(), 1);
  } finally {
    rig.session.stop();
  }
});

test("a remote on an unknown host stays empty, starts no skeleton and asks gh only about that host", async () => {
  const rig = start(routed_client({}), { kind: "found", exe: "gh.exe", accounts: [] }, { ...target, repo: { host: "gitlab.com", owner: "g", name: "r" }, host_kind: "other" });
  try {
    await wait_until("the empty view", () => rig.views.length > 0);
    assert.deepEqual(rig.views, [{ kind: "none" }]);
    assert.deepEqual([...rig.reads.hosts], ["gitlab.com"]);
  } finally {
    rig.session.stop();
  }
});

test("a new session for the same folder within max-age shows the last view again without asking GitHub", async () => {
  const calls: TransportCall[] = [];
  const client = routed_client(public_routes(sha("a")), {}, calls);
  const first = start(client, { kind: "missing" });
  let memory: RepoMemory | null = null;
  try {
    await wait_until("the data", () => first.last()?.kind === "data");
    memory = first.session.memory();
  } finally {
    first.session.stop();
  }
  const asked = calls.length;
  const second = start(client, { kind: "missing" }, target, memory);
  try {
    assert.equal(second.views[0]?.kind, "data");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(calls.length, asked);
    assert.deepEqual(second.views.map((view) => view.kind), ["data"]);
  } finally {
    second.session.stop();
  }
});

test("another branch drops the pull request and checks at once, a detached HEAD keeps only the repository", async () => {
  const head = sha("d");
  const routes: Record<string, Route> = {
    ...public_routes(sha("a")),
    [`repos/7teb/VantheaX/pulls?head=${encodeURIComponent("7teb:main")}&state=all&sort=created&direction=desc&per_page=1`]: reply(200, [
      { number: 15, title: "Show Initialize", state: "closed", merged_at: null, html_url: "https://github.com/7teb/VantheaX/pull/15", head: { sha: head } },
    ]),
    [`repos/7teb/VantheaX/commits/${head}/check-runs?per_page=100`]: reply(200, { total_count: 1, check_runs: [{ name: "build", status: "completed", conclusion: "success" }] }),
  };
  const rig = start(routed_client(routes), { kind: "missing" });
  try {
    await wait_until("the pull request", () => rig.last()?.kind === "data" && last_data(rig).pr !== null);
    assert.equal(last_data(rig).checks?.state, "passed");
    rig.session.update({ ...target, branch: "feat/x", tracking: null });
    assert.deepEqual([last_data(rig).branch, last_data(rig).pr, last_data(rig).checks], [{ kind: "none" }, null, null]);
    rig.session.update({ ...target, branch: null, tracking: null });
    assert.deepEqual([last_data(rig).branch, last_data(rig).pr, last_data(rig).checks], [{ kind: "none" }, null, null]);
  } finally {
    rig.session.stop();
  }
});

test("a fetch that brings GitHub's head makes the branch the same at once", async () => {
  const rig = start(routed_client(public_routes(sha("b"))), { kind: "missing" });
  try {
    await wait_until("the data", () => rig.last()?.kind === "data");
    assert.notEqual(last_data(rig).branch.kind, "same");
    rig.session.update({ ...target, tracking: sha("b") });
    assert.deepEqual(last_data(rig).branch, { kind: "same", sha: sha("b") });
  } finally {
    rig.session.stop();
  }
});

test("a rate limit of the anonymous API without data offers the GitHub CLI login or its download", async () => {
  const limited = reply(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1792112009" });
  const signed_out = start(routed_client({ "repos/7teb/VantheaX": limited }), { kind: "found", exe: "gh.exe", accounts: [] });
  try {
    await wait_until("the limit row", () => signed_out.last()?.kind === "unavailable");
    assert.deepEqual(signed_out.last(), {
      kind: "unavailable",
      repo: target.repo,
      reason: "rate_limited",
      reset_at: new Date(1792112009 * 1000).toISOString(),
      status: null,
      cli: { state: "signed_out", version: null },
      command: "gh auth login",
    });
  } finally {
    signed_out.session.stop();
  }
  const missing = start(routed_client({ "repos/7teb/VantheaX": limited }), { kind: "missing" });
  try {
    await wait_until("the limit row", () => missing.last()?.kind === "unavailable");
    const view = missing.last();
    assert.deepEqual(view?.kind === "unavailable" ? [view.cli, view.command] : null, [{ state: "missing", version: null }, null]);
  } finally {
    missing.session.stop();
  }
});

test("refresh after a new gh login reads the repository through that account", async () => {
  const client = routed_client(public_routes(sha("a")), public_routes(sha("a")));
  const rig = start(client, { kind: "found", exe: "gh.exe", accounts: [] });
  try {
    await wait_until("the anonymous data", () => rig.last()?.kind === "data");
    assert.equal(last_data(rig).source, "anonymous");
    rig.reads.status = { kind: "found", exe: "gh.exe", accounts: [{ host: "github.com", login: "octo", active: true, state: "success" }] };
    rig.session.refresh();
    await wait_until("the data through gh", () => rig.last()?.kind === "data" && last_data(rig).source === "gh");
    assert.equal(last_data(rig).source_login, "octo");
  } finally {
    rig.session.stop();
  }
});
