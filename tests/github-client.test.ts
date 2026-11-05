import assert from "node:assert/strict";
import { test } from "node:test";
import { api_path, create_github_client, net_transport, next_link, type GithubSource, type NetInit, type TransportCall } from "../electron/github/client.ts";
import { fresh_tally, reply, routed_client, route_transport } from "./github-kit.ts";

const anonymous: GithubSource = { kind: "anonymous" };

const gh: GithubSource = { kind: "gh", login: "octo" };

const get = (client: ReturnType<typeof routed_client>, path: string, source: GithubSource = anonymous, tally = fresh_tally(), signal = new AbortController().signal) =>
  client.get({ source, host: "github.com", path, signal, tally });

test("branch names are encoded per path part, query values through URLSearchParams", () => {
  assert.equal(api_path(["repos", "o", "r", "branches", ..."fix#1".split("/")]), "repos/o/r/branches/fix%231");
  assert.equal(api_path(["repos", "o", "r", "branches", ..."a&b=c".split("/")]), "repos/o/r/branches/a%26b%3Dc");
  assert.equal(api_path(["repos", "o", "r", "branches", ..."feat/x".split("/")]), "repos/o/r/branches/feat/x");
  assert.equal(api_path(["repos", "o", "r", "pulls"], { head: "o:fix#1&x=1", state: "all" }), "repos/o/r/pulls?head=o%3Afix%231%26x%3D1&state=all");
});

test("every answer lands in its error class", async () => {
  const routes = {
    "a": reply(401, { message: "Bad credentials" }),
    "b": reply(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "4102444800" }),
    "c": reply(403, { message: "Resource protected by organization SAML enforcement" }, { "x-github-sso": "required; url=https://github.com/orgs/acme/sso?authorization_request=abc" }),
    "d": reply(403, { message: "Forbidden" }),
    "e": reply(404, { message: "Not Found" }),
    "f": reply(422, { message: "No common ancestor" }),
    "g": reply(502, ""),
  };
  const client = routed_client(routes, routes);
  assert.deepEqual(await get(client, "a"), { kind: "unauthorized" });
  assert.deepEqual(await get(client, "c"), { kind: "denied", sso: "https://github.com/orgs/acme/sso?authorization_request=abc" });
  assert.deepEqual(await get(client, "b"), { kind: "rate_limited", reset_at: 4102444800000 });
  assert.deepEqual(await get(client, "d", gh), { kind: "denied", sso: null });
  assert.deepEqual(await get(client, "e", gh), { kind: "missing", status: 404 });
  assert.deepEqual(await get(client, "f", gh), { kind: "missing", status: 422 });
  assert.deepEqual(await get(client, "g", gh), { kind: "server_error", status: 502 });
  const offline = create_github_client({ anonymous: async () => ({ kind: "offline", detail: "getaddrinfo ENOTFOUND api.github.com" }), gh: async () => ({ kind: "signed_out", detail: "exit code 4" }) });
  assert.deepEqual(await get(offline, "x"), { kind: "offline" });
  assert.deepEqual(await get(offline, "x", gh), { kind: "unauthorized" });
});

test("a rate limit blocks the identity until the reset without sending another request", async () => {
  let now = 1_000_000;
  const calls: TransportCall[] = [];
  const client = create_github_client({ anonymous: route_transport({ "x": reply(429, { message: "slow down" }, { "retry-after": "30" }) }, calls), gh: route_transport({}), now: () => now });
  assert.deepEqual(await get(client, "x"), { kind: "rate_limited", reset_at: 1_030_000 });
  assert.deepEqual(await get(client, "y"), { kind: "rate_limited", reset_at: 1_030_000 });
  assert.equal(calls.length, 1);
  assert.equal(client.rate(anonymous, "github.com").blocked_until, 1_030_000);
  now = 1_031_000;
  await get(client, "y");
  assert.equal(calls.length, 2);
});

test("a 304 answers from the ETag cache, anonymous 304s count against the budget and authorized ones do not", async () => {
  const calls: TransportCall[] = [];
  const answer = (call: TransportCall) =>
    call.headers["If-None-Match"] === 'W/"one"' ? reply(304, undefined, { etag: '"one"' }) : reply(200, { full_name: "o/r" }, { etag: 'W/"one"', "cache-control": "private, max-age=60, s-maxage=60" });
  const client = create_github_client({ anonymous: route_transport({ "repos/o/r": answer }, calls), gh: route_transport({ "repos/o/r": answer }, calls) });
  for (const source of [anonymous, gh]) {
    const first = fresh_tally();
    assert.deepEqual(await get(client, "repos/o/r", source, first), { kind: "ok", body: { full_name: "o/r" }, next: null });
    assert.equal(first.counted, 1);
    assert.equal(first.max_age_ms, 60_000);
    const second = fresh_tally();
    assert.deepEqual(await get(client, "repos/o/r", source, second), { kind: "ok", body: { full_name: "o/r" }, next: null });
    assert.equal(second.counted, source.kind === "anonymous" ? 1 : 0);
  }
  assert.equal(calls.filter((call) => call.headers["If-None-Match"]).length, 2);
  assert.equal(calls[0]?.headers["X-GitHub-Api-Version"], "2026-03-10");
  assert.equal(calls[0]?.headers.Accept, "application/vnd.github+json");
});

test("pages follow the Link header inside the API base and stop when it points elsewhere", async () => {
  assert.equal(next_link('<https://api.github.com/r?page=2>; rel="next", <https://api.github.com/r?page=3>; rel="last"'), "https://api.github.com/r?page=2");
  const client = routed_client({
    "repos/o/r/commits/x/check-runs?per_page=100": reply(200, { total_count: 3, check_runs: [1, 2] }, { link: '<https://api.github.com/repositories/9/commits/x/check-runs?per_page=100&page=2>; rel="next"' }),
    "repositories/9/commits/x/check-runs?per_page=100&page=2": reply(200, { total_count: 3, check_runs: [3] }, { link: '<https://evil.example/next>; rel="next"' }),
  });
  const pages = await client.get_pages({ source: anonymous, host: "github.com", path: "repos/o/r/commits/x/check-runs?per_page=100", signal: new AbortController().signal, tally: fresh_tally() });
  assert.equal(pages.kind, "ok");
  assert.equal(pages.kind === "ok" ? pages.bodies.length : 0, 2);
});

test("requests to one host run one after another and a hanging one is ended by its signal", async () => {
  const order: string[] = [];
  let release_first = () => {};
  const transport = route_transport({
    "first": () =>
      new Promise((resolve) => {
        order.push("first started");
        release_first = () => resolve(reply(200, {}));
      }),
    "second": () => {
      order.push("second started");
      return reply(200, {});
    },
  });
  const client = create_github_client({ anonymous: transport, gh: transport });
  const first = get(client, "first");
  const second = get(client, "second");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(order, ["first started"]);
  release_first();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first started", "second started"]);

  const hanging = create_github_client({
    anonymous: ({ path, signal }) =>
      path === "stuck"
        ? new Promise<never>((...settle) => signal.addEventListener("abort", () => settle[1](signal.reason), { once: true }))
        : Promise.resolve({ kind: "response", response: reply(200, { ok: true }) }),
    gh: route_transport({}),
  });
  const controller = new AbortController();
  const stuck = get(hanging, "stuck", anonymous, fresh_tally(), controller.signal);
  const next = get(hanging, "fine");
  controller.abort(new Error("refresh restarts the GitHub round"));
  await assert.rejects(stuck, /refresh restarts/);
  assert.deepEqual(await next, { kind: "ok", body: { ok: true }, next: null });
});

test("net requests never use the HTTP cache or cookies and log no headers", async () => {
  const seen: { url: string; init: NetInit }[] = [];
  const fetcher = async (url: string, init: NetInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ message: "Server Error" }), { status: 500, headers: { etag: '"secret-etag"', "x-ratelimit-remaining": "41" } });
  };
  const logged: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  try {
    const client = create_github_client({ anonymous: net_transport(fetcher), gh: route_transport({}) });
    assert.deepEqual(await get(client, "repos/o/r"), { kind: "server_error", status: 500 });
  } finally {
    console.warn = original;
  }
  assert.equal(seen[0]?.url, "https://api.github.com/repos/o/r");
  assert.equal(seen[0]?.init.cache, "no-store");
  assert.equal(seen[0]?.init.credentials, "omit");
  assert.equal(logged.length, 1);
  assert.match(logged[0] ?? "", /repos\/o\/r answered 500, 41 requests left/);
  assert.doesNotMatch(logged.join("\n"), /secret-etag|etag|accept|authorization|x-github-api-version/i);
});

test("prune drops cached answers the latest round did not use", async () => {
  const calls: TransportCall[] = [];
  const client = create_github_client({ anonymous: route_transport({ "a": reply(200, 1, { etag: '"a"' }), "b": reply(200, 2, { etag: '"b"' }) }, calls), gh: route_transport({}) });
  const first = fresh_tally();
  await get(client, "a", anonymous, first);
  const second = fresh_tally();
  await get(client, "b", anonymous, second);
  client.prune(second);
  await get(client, "a");
  await get(client, "b");
  assert.equal(calls.at(-2)?.headers["If-None-Match"], undefined);
  assert.equal(calls.at(-1)?.headers["If-None-Match"], '"b"');
});
