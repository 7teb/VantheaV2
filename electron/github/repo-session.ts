import type { GitHostKind, GitView } from "../../shared/git-view.ts";
import type { GithubBranch, GithubCli, GithubData, GithubRepoRef, GithubRepoView, GithubStale } from "../../shared/github-view.ts";
import type { GitWindow, RemoteHead } from "../git/fetch.ts";
import type { GitRef } from "../git/refs.ts";
import { error_text } from "../storage/coerce.ts";
import { login_command, resolve_access, type GithubTroubleResult, type HostClass } from "./access.ts";
import type { GithubClient, GithubSource, RoundTally } from "./client.ts";
import { cli_of, host_account, host_pattern, type GhCache, type GhStatus } from "./gh-cli.ts";
import { create_poller, default_max_age_ms, type PollerMemory, type RoundCause, type RoundFacts } from "./poll.ts";
import { parse_repo_info, read_round, type RepoInfo } from "./repo-view.ts";

export type GithubTarget = { repo: GithubRepoRef; host_kind: GitHostKind; remote: string; remote_url: string; branch: string | null; tracking: string | null };

export type RepoSessionDeps = {
  client: GithubClient;
  gh: GhCache;
  window: GitWindow;
  publish: (view: GithubRepoView) => void;
  fetch_head: (head: RemoteHead) => void;
  now?: () => number;
};

export type RepoMemory = { target: GithubTarget; view: GithubRepoView; data: GithubData | null; remote_sha: string | null; round: PollerMemory | null };

export type RepoSession = { update: (target: GithubTarget) => void; refresh: () => void; republish: () => void; memory: () => RepoMemory | null; stop: () => void };

type Chain = { source: GithubSource; info: RepoInfo; login: string | null };

type RateHint = { cli: GithubCli | null; command: string | null };

const hosted_kinds = new Set<GitHostKind>(["github", "ghe_com", "other"]);

const blocked_kinds = new Set<GithubRepoView["kind"]>(["cli_host", "needs_sign_in", "no_access", "sso"]);

export const github_target = (view: GitView, refs: GitRef[]): GithubTarget | null => {
  if (view.kind !== "repo") return null;
  const remote = view.remotes.find((entry) => entry.name === view.primary_remote);
  if (!remote?.host || !remote.slug || !hosted_kinds.has(remote.host_kind)) return null;
  const [owner = "", name = ""] = remote.slug.split("/");
  const host = remote.host_kind === "github" ? "github.com" : remote.host;
  if (!host_pattern.test(host)) return null;
  const local = view.branch.name;
  const upstream = view.branch.upstream;
  const branch = local === null ? null : upstream?.startsWith(`${remote.name}/`) ? upstream.slice(remote.name.length + 1) : local;
  const tracking = branch === null ? null : (refs.find((ref) => ref.kind === "remote" && ref.name === `${remote.name}/${branch}`)?.hash ?? null);
  return { repo: { host, owner, name }, host_kind: remote.host_kind, remote: remote.name, remote_url: remote.url, branch, tracking };
};

export const host_class_of = (target: GithubTarget, status: GhStatus | null): HostClass | null => {
  if (target.host_kind === "github") return "github";
  if (target.host_kind === "ghe_com") return "ghe_com";
  return status && host_account(status, target.repo.host) ? "ghes" : null;
};

const same_repo = (left: GithubTarget, right: GithubTarget): boolean =>
  left.remote === right.remote && left.remote_url === right.remote_url && JSON.stringify(left.repo) === JSON.stringify(right.repo);

const same_branch = (left: GithubTarget, right: GithubTarget): boolean => left.branch === right.branch && left.tracking === right.tracking;

const without_time = (view: GithubRepoView | null): string => JSON.stringify(view?.kind === "data" ? { ...view, updated_at: "" } : view);

export const create_repo_session = (first: GithubTarget, deps: RepoSessionDeps, memory: RepoMemory | null = null): RepoSession => {
  const now = deps.now ?? Date.now;
  const seed = memory && same_repo(memory.target, first) ? memory : null;
  let target = seed?.target ?? first;
  let chain: Chain | null = null;
  let data = seed?.data ?? null;
  let view = seed?.view ?? null;
  let remote_sha = seed?.remote_sha ?? null;
  let cli: GithubCli | null = null;
  let max_age = seed?.round?.facts.max_age_ms ?? default_max_age_ms;
  let fresh_cli = false;

  const show = (next: GithubRepoView) => {
    const changed = without_time(next) !== without_time(view);
    view = next;
    if (changed) deps.publish(next);
  };

  const facts_of = (source: GithubSource | null, tally: RoundTally, server_error: boolean, browser_step: boolean): RoundFacts => {
    if (tally.max_age_ms !== null) max_age = tally.max_age_ms;
    const rate = source ? deps.client.rate(source, target.repo.host) : null;
    return {
      max_age_ms: max_age,
      poll_ms: tally.poll_ms,
      cost: tally.counted,
      remaining: rate?.remaining ?? null,
      reset_at: rate?.reset_at ?? null,
      blocked_until: rate?.blocked_until ?? null,
      anonymous: source?.kind === "anonymous",
      server_error,
      browser_step,
    };
  };

  const rate_hint = (trouble: GithubTroubleResult, source: GithubSource | null): RateHint => {
    if (trouble.kind !== "rate_limited" || source?.kind !== "anonymous" || cli === null || cli.state === "ready") {
      return { cli: null, command: null };
    }
    return { cli, command: cli.state === "signed_out" ? login_command(target.repo.host) : null };
  };

  const show_trouble = (trouble: GithubTroubleResult, source: GithubSource | null) => {
    const stale: GithubStale = {
      reason: trouble.kind,
      reset_at: trouble.kind === "rate_limited" ? new Date(trouble.reset_at).toISOString() : null,
      status: trouble.kind === "server_error" ? trouble.status : null,
    };
    show(data ? { ...data, stale } : { kind: "unavailable", repo: target.repo, ...stale, ...rate_hint(trouble, source) });
  };

  const shift = (previous: GithubTarget, next: GithubTarget) => {
    const renamed = next.branch !== previous.branch;
    if (renamed) remote_sha = null;
    if (!data) return;
    const branch: GithubBranch = !renamed && remote_sha !== null && next.tracking === remote_sha ? { kind: "same", sha: remote_sha } : { kind: "none" };
    data = renamed ? { ...data, branch, pr: null, checks: null } : { ...data, branch };
    show(data);
  };

  const trigger_fetch = (aimed: GithubTarget, head_sha: string | null) => {
    const { branch, tracking } = aimed;
    if (branch === null || head_sha === null || head_sha === tracking) return;
    try {
      deps.fetch_head({ branch, sha: head_sha, tracking });
    } catch (error) {
      console.warn(`[github] asking for a fetch of ${branch} at ${head_sha} failed: ${error_text(error)}`);
    }
  };

  const gh_status = (cause: RoundCause): Promise<GhStatus> => {
    const blocked = view !== null && blocked_kinds.has(view.kind);
    const reread = fresh_cli || cause === "refresh" || ((cause === "focus" || cause === "start") && blocked);
    fresh_cli = false;
    return reread ? deps.gh.reread(target.repo.host) : deps.gh.status(target.repo.host);
  };

  const resolve = async (status: GhStatus, signal: AbortSignal, tally: RoundTally): Promise<RoundFacts | Chain | null> => {
    const host_class = host_class_of(target, status);
    if (host_class === null) {
      data = null;
      show({ kind: "none" });
      return null;
    }
    if (view === null || view.kind === "none") show({ kind: "loading", repo: target.repo });
    const { host } = target.repo;
    const account = host_account(status, host);
    const access = await resolve_access({ client: deps.client, repo: target.repo, host_class, account, cli: cli_of(status, host), signal, tally });
    if (access.kind === "blocked") {
      data = null;
      show(access.view);
      return facts_of(access.source, tally, false, true);
    }
    if (access.kind === "trouble") {
      show_trouble(access.trouble, access.source);
      return facts_of(access.source, tally, access.trouble.kind === "server_error", false);
    }
    return { source: access.source, info: parse_repo_info(access.body, target.repo), login: account?.login ?? null };
  };

  const round = async (cause: RoundCause, signal: AbortSignal, tally: RoundTally, retried: boolean): Promise<RoundFacts | null> => {
    const status = await gh_status(cause);
    if (signal.aborted) return null;
    const { host } = target.repo;
    cli = cli_of(status, host);
    if (chain && chain.login !== (host_account(status, host)?.login ?? null)) chain = null;
    if (!chain) {
      const resolved = await resolve(status, signal, tally);
      if (signal.aborted) return null;
      if (resolved === null || !("info" in resolved)) return resolved;
      chain = resolved;
    }
    const current = chain;
    const aimed = target;
    const read = await read_round({ client: deps.client, source: current.source, info: current.info, target: aimed, signal, tally });
    if (signal.aborted) return null;
    if (read.kind === "lost") {
      chain = null;
      fresh_cli = true;
      return retried ? facts_of(current.source, tally, false, false) : round(cause, signal, tally, true);
    }
    if (read.kind === "trouble") {
      show_trouble(read.trouble, current.source);
      return facts_of(current.source, tally, read.trouble.kind === "server_error", false);
    }
    if (!same_branch(aimed, target)) return facts_of(current.source, tally, false, false);
    remote_sha = read.remote_sha;
    data = {
      kind: "data",
      ...current.info,
      branch: read.branch,
      pr: read.pr,
      checks: read.checks,
      source: current.source.kind,
      source_login: current.source.kind === "gh" ? current.source.login : null,
      updated_at: new Date(now()).toISOString(),
      stale: null,
    };
    show(data);
    deps.client.prune(tally);
    trigger_fetch(aimed, read.remote_sha);
    return facts_of(current.source, tally, false, false);
  };

  const run = async (cause: RoundCause, signal: AbortSignal): Promise<RoundFacts | null> => {
    const tally: RoundTally = { counted: 0, max_age_ms: null, poll_ms: null };
    try {
      return await round(cause, signal, tally, false);
    } catch (error) {
      if (signal.aborted) return null;
      console.error(`[github] the round for ${target.repo.owner}/${target.repo.name} on ${target.repo.host} failed:`, error);
      show_trouble({ kind: "server_error", status: null }, null);
      return facts_of(chain?.source ?? null, tally, true, false);
    }
  };

  const poller = create_poller(deps.window, run, now, seed?.round ?? null);

  const update = (next: GithubTarget) => {
    const previous = target;
    target = next;
    if (!same_repo(previous, next)) {
      chain = null;
      data = null;
      remote_sha = null;
      if (next.host_kind !== "other") show({ kind: "loading", repo: next.repo });
      poller.trigger("refresh");
      return;
    }
    if (same_branch(previous, next)) return;
    shift(previous, next);
    poller.trigger("change");
  };

  if (view !== null) deps.publish(view);
  else if (target.host_kind !== "other") show({ kind: "loading", repo: target.repo });
  if (seed && !same_branch(seed.target, first)) update(first);
  else poller.trigger("start");

  return {
    update,
    refresh: () => poller.trigger("refresh"),
    republish: () => {
      if (view) deps.publish(view);
    },
    memory: () => (view === null ? null : { target, view, data, remote_sha, round: poller.memory() }),
    stop: () => poller.stop(),
  };
};
