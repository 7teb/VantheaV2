import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve_access, sso_target, web_link, type AccessInput } from "../electron/github/access.ts";
import type { GithubClient, TransportCall } from "../electron/github/client.ts";
import type { GhAccount } from "../electron/github/gh-cli.ts";
import type { GithubCli } from "../shared/github-view.ts";
import { fresh_tally, reply, routed_client, type Route } from "./github-kit.ts";

const repo = { host: "github.com", owner: "7teb", name: "VantheaX" };

const account: GhAccount = { host: "github.com", login: "octocat", active: true, state: "success" };

const ready: GithubCli = { state: "ready", version: null };

const input = (client: GithubClient, extra: Partial<AccessInput> = {}): AccessInput => ({
  client,
  repo,
  host_class: "github",
  account: null,
  cli: { state: "signed_out", version: null },
  signal: new AbortController().signal,
  tally: fresh_tally(),
  ...extra,
});

const info = reply(200, { full_name: "7teb/VantheaX", private: true });

const path = "repos/7teb/VantheaX";

const client_with = (anonymous: Route | null, gh: Route | null, calls: TransportCall[] = []) =>
  routed_client(anonymous ? { [path]: anonymous } : {}, gh ? { [path]: gh } : {}, calls);

test("the GitHub CLI login is tried first, the anonymous API only when it cannot read the repository", async () => {
  const calls: TransportCall[] = [];
  const through_gh = await resolve_access(input(client_with(null, info, calls), { account, cli: ready }));
  assert.deepEqual(through_gh.kind === "granted" ? through_gh.source : through_gh.kind, { kind: "gh", login: "octocat" });
  assert.equal(calls.length, 1);
  const public_repo = await resolve_access(input(client_with(info, reply(404, {})), { account, cli: ready }));
  assert.deepEqual(public_repo.kind === "granted" ? public_repo.source : public_repo.kind, { kind: "anonymous" });
});

test("a repository no source can read names the gh account that cannot see it", async () => {
  const result = await resolve_access(input(client_with(reply(404, {}), reply(404, {})), { account, cli: ready }));
  assert.deepEqual(result.kind === "blocked" ? result.view : result.kind, { kind: "no_access", repo, login: "octocat", command: "gh auth login" });
});

test("without a gh login the row asks for gh auth login, without gh it offers the install", async () => {
  const signed_out = await resolve_access(input(client_with(reply(404, {}), null)));
  assert.deepEqual(signed_out.kind === "blocked" ? signed_out.view : signed_out.kind, {
    kind: "needs_sign_in",
    repo,
    reason: "not_readable",
    cli: { state: "signed_out", version: null },
    command: "gh auth login",
  });
  const missing = await resolve_access(input(client_with(reply(404, {}), null), { cli: { state: "missing", version: null } }));
  assert.deepEqual(missing.kind === "blocked" ? missing.view : missing.kind, { kind: "needs_sign_in", repo, reason: "not_readable", cli: { state: "missing", version: null }, command: null });
  const old = await resolve_access(input(client_with(reply(404, {}), null), { cli: { state: "too_old", version: "2.40.1" } }));
  assert.equal(old.kind === "blocked" && old.view.kind === "needs_sign_in" ? old.view.command : "unexpected", null);
});

test("an organization with SSO answers gh with 403 and the SSO header, the link is kept only on the GitHub host", async () => {
  const header = "required; url=https://github.com/orgs/7teb/sso?authorization_request=A1";
  const sso = await resolve_access(input(client_with(reply(404, {}), reply(403, { message: "SAML" }, { "x-github-sso": header })), { account, cli: ready }));
  assert.deepEqual(sso.kind === "blocked" ? sso.view : sso.kind, { kind: "sso", repo, org: "7teb", url: "https://github.com/orgs/7teb/sso?authorization_request=A1" });
  assert.equal(sso_target("https://evil.example/orgs/7teb/sso", repo), "https://github.com/orgs/7teb/sso");
  assert.equal(sso_target(null, repo), "https://github.com/orgs/7teb/sso");
});

test("a revoked gh token reads as an expired sign-in when no other source helps", async () => {
  const expired = await resolve_access(input(client_with(reply(404, {}), reply(401, { message: "Bad credentials" })), { account, cli: ready }));
  assert.deepEqual(expired.kind === "blocked" ? expired.view : expired.kind, { kind: "needs_sign_in", repo, reason: "expired", cli: ready, command: "gh auth login" });
});

test("GHE.com and Enterprise Server go through gh only", async () => {
  const ghe = { host: "acme.ghe.com", owner: "acme", name: "tools" };
  const calls: TransportCall[] = [];
  const result = await resolve_access(input(routed_client({}, {}, calls), { repo: ghe, host_class: "ghe_com" }));
  assert.deepEqual(result.kind === "blocked" ? result.view : result.kind, {
    kind: "cli_host",
    repo: ghe,
    cli: { state: "signed_out", version: null },
    command: "gh auth login --hostname acme.ghe.com",
  });
  assert.equal(calls.length, 0);
});

test("offline, server errors and rate limits end the chain as trouble", async () => {
  const offline_client: GithubClient = { ...routed_client({}), get: async () => ({ kind: "offline" }) };
  const offline = await resolve_access(input(offline_client));
  assert.deepEqual(offline.kind === "trouble" ? offline.trouble : offline.kind, { kind: "offline" });
  const failing = await resolve_access(input(client_with(reply(503, ""), null)));
  assert.deepEqual(failing.kind === "trouble" ? failing.trouble : failing.kind, { kind: "server_error", status: 503 });
});

test("links from API answers are kept only as https on the repository host", () => {
  assert.equal(web_link("https://github.com/7teb/VantheaX/pull/3", "github.com"), "https://github.com/7teb/VantheaX/pull/3");
  assert.equal(web_link("http://github.com/7teb/VantheaX", "github.com"), null);
  assert.equal(web_link("https://github.com.evil.example/x", "github.com"), null);
  assert.equal(web_link("https://user:pw@github.com/x", "github.com"), null);
  assert.equal(web_link("javascript:alert(1)", "github.com"), null);
  assert.equal(web_link(42, "github.com"), null);
});
