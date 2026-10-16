import type { GithubCli, GithubRepoRef, GithubRepoView } from "../../shared/github-view.ts";
import { api_path, type GithubClient, type GithubFailure, type GithubSource, type RoundTally } from "./client.ts";
import type { GhAccount } from "./gh-cli.ts";

export type HostClass = "github" | "ghe_com" | "ghes";

export type AccessBlock = Extract<GithubRepoView, { kind: "cli_host" | "needs_sign_in" | "no_access" | "sso" }>;

export type GithubTroubleResult = Extract<GithubFailure, { kind: "rate_limited" | "server_error" | "offline" }>;

export type Access =
  | { kind: "granted"; source: GithubSource; body: unknown }
  | { kind: "blocked"; view: AccessBlock; source: GithubSource | null }
  | { kind: "trouble"; trouble: GithubTroubleResult; source: GithubSource };

export type AccessInput = {
  client: GithubClient;
  repo: GithubRepoRef;
  host_class: HostClass;
  account: GhAccount | null;
  cli: GithubCli;
  signal: AbortSignal;
  tally: RoundTally;
};

type Refusals = { sso: string | null; expired: boolean; hidden: string | null };

export const login_command = (host: string): string => (host === "github.com" ? "gh auth login" : `gh auth login --hostname ${host}`);

export const web_link = (value: unknown, host: string): string | null => {
  if (typeof value !== "string" || !URL.canParse(value)) {
    return null;
  }
  const url = new URL(value);
  return url.protocol === "https:" && url.host === host && !url.username && !url.password ? url.href : null;
};

export const sso_target = (header: string | null, repo: GithubRepoRef): string => web_link(header, repo.host) ?? `https://${repo.host}/orgs/${repo.owner}/sso`;

const is_trouble = (result: { kind: string }): result is GithubTroubleResult =>
  result.kind === "rate_limited" || result.kind === "server_error" || result.kind === "offline";

export const blocked_view = (repo: GithubRepoRef, host_class: HostClass, cli: GithubCli, refusals: Refusals): AccessBlock => {
  const usable = cli.state === "ready" || cli.state === "signed_out";
  const command = usable ? login_command(repo.host) : null;
  if (refusals.sso !== null) return { kind: "sso", repo, org: repo.owner, url: sso_target(refusals.sso, repo) };
  if (refusals.expired) return { kind: "needs_sign_in", repo, reason: "expired", cli, command: login_command(repo.host) };
  if (refusals.hidden !== null) return { kind: "no_access", repo, login: refusals.hidden, command: login_command(repo.host) };
  if (host_class !== "github") return { kind: "cli_host", repo, cli, command };
  return { kind: "needs_sign_in", repo, reason: "not_readable", cli, command };
};

export const resolve_access = async (input: AccessInput): Promise<Access> => {
  const { client, repo, account, signal, tally } = input;
  const path = api_path(["repos", repo.owner, repo.name]);
  const refusals: Refusals = { sso: null, expired: false, hidden: null };
  if (account) {
    const source: GithubSource = { kind: "gh", login: account.login };
    const result = await client.get({ source, host: repo.host, path, signal, tally });
    if (result.kind === "ok") return { kind: "granted", source, body: result.body };
    if (is_trouble(result)) return { kind: "trouble", trouble: result, source };
    if (result.kind === "denied" && result.sso !== null) refusals.sso = result.sso;
    else if (result.kind === "unauthorized") refusals.expired = true;
    else refusals.hidden = account.login;
  }
  if (input.host_class !== "github") {
    return { kind: "blocked", view: blocked_view(repo, input.host_class, input.cli, refusals), source: account ? { kind: "gh", login: account.login } : null };
  }
  const anonymous: GithubSource = { kind: "anonymous" };
  const result = await client.get({ source: anonymous, host: repo.host, path, signal, tally });
  if (result.kind === "ok") return { kind: "granted", source: anonymous, body: result.body };
  if (is_trouble(result)) return { kind: "trouble", trouble: result, source: anonymous };
  return { kind: "blocked", view: blocked_view(repo, "github", input.cli, refusals), source: anonymous };
};
