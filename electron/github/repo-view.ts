import type { GithubBranch, GithubCheck, GithubChecks, GithubData, GithubPr, GithubPrState, GithubRepoRef, GithubReviews } from "../../shared/github-view.ts";
import { run_state, status_state, summarize_checks, type CheckRun } from "../../shared/github/checks.ts";
import { summarize_reviews } from "../../shared/github/reviews.ts";
import { as_array, is_record, require_record } from "../storage/coerce.ts";
import { web_link, type GithubTroubleResult } from "./access.ts";
import { api_path, type GithubClient, type GithubPages, type GithubResult, type GithubSource, type RoundTally } from "./client.ts";

export type RepoInfo = Pick<GithubData, "repo" | "html_url" | "visibility" | "archived" | "fork_parent" | "renamed_from">;

export type RoundTarget = { branch: string | null; tracking: string | null };

export type RoundContext = { client: GithubClient; source: GithubSource; info: RepoInfo; target: RoundTarget; signal: AbortSignal; tally: RoundTally };

export type RoundRead =
  | { kind: "data"; branch: GithubBranch; pr: GithubPr | null; checks: GithubChecks | null; remote_sha: string | null }
  | { kind: "trouble"; trouble: GithubTroubleResult }
  | { kind: "lost" };

type Stop = Exclude<RoundRead, { kind: "data" }>;

type Got = { kind: "ok"; body: unknown } | { kind: "absent" };

type GotPages = { kind: "ok"; bodies: unknown[] } | { kind: "absent" };

type FoundPr = { pr: GithubPr; head_sha: string | null; repo: GithubRepoRef };

class RoundStopped extends Error {
  read: Stop;

  constructor(read: Stop) {
    super(`the GitHub round stopped: ${read.kind}`);
    this.read = read;
  }
}

const slug_pattern = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/;

const sha_pattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

const visibilities = ["public", "private", "internal"] as const;

const sha_of = (value: unknown): string | null => (typeof value === "string" && sha_pattern.test(value) ? value : null);

const time_of = (value: unknown): string | null => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null);

const count_of = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);

const text_of = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

export const parse_repo_info = (body: unknown, requested: GithubRepoRef): RepoInfo => {
  const raw = require_record(body, "GitHub repository");
  const full_name = typeof raw.full_name === "string" ? raw.full_name : "";
  const match = slug_pattern.exec(full_name);
  if (!match?.[1] || !match[2]) {
    throw new Error(`GitHub answered for ${requested.owner}/${requested.name} without a usable full_name`);
  }
  const requested_name = `${requested.owner}/${requested.name}`;
  const parent = is_record(raw.parent) && typeof raw.parent.full_name === "string" && slug_pattern.test(raw.parent.full_name) ? raw.parent.full_name : null;
  const named = visibilities.find((entry) => entry === raw.visibility);
  return {
    repo: { host: requested.host, owner: match[1], name: match[2] },
    html_url: web_link(raw.html_url, requested.host),
    visibility: named ?? (typeof raw.private === "boolean" ? (raw.private ? "private" : "public") : null),
    archived: raw.archived === true,
    fork_parent: raw.fork === true ? parent : null,
    renamed_from: full_name.toLowerCase() === requested_name.toLowerCase() ? null : requested_name,
  };
};

const stop_of = (result: Exclude<GithubResult | GithubPages, { kind: "ok" | "missing" | "denied" }>): Stop =>
  result.kind === "unauthorized" ? { kind: "lost" } : { kind: "trouble", trouble: result };

const reader_of = (ctx: RoundContext) => {
  const request = (segments: string[], query?: Record<string, string>) => ({
    source: ctx.source,
    host: ctx.info.repo.host,
    path: api_path(segments, query),
    signal: ctx.signal,
    tally: ctx.tally,
  });
  return {
    get: async (segments: string[], query?: Record<string, string>): Promise<Got> => {
      const result = await ctx.client.get(request(segments, query));
      if (result.kind === "ok") return { kind: "ok", body: result.body };
      if (result.kind === "missing" || result.kind === "denied") return { kind: "absent" };
      throw new RoundStopped(stop_of(result));
    },
    pages: async (segments: string[], query?: Record<string, string>): Promise<GotPages> => {
      const result = await ctx.client.get_pages(request(segments, query));
      if (result.kind === "ok") return result;
      if (result.kind === "missing" || result.kind === "denied") return { kind: "absent" };
      throw new RoundStopped(stop_of(result));
    },
  };
};

type Reader = ReturnType<typeof reader_of>;

const repo_segments = (repo: GithubRepoRef): string[] => ["repos", repo.owner, repo.name];

const read_branch = async (ctx: RoundContext, reader: Reader): Promise<{ state: GithubBranch; sha: string | null }> => {
  const { branch, tracking } = ctx.target;
  if (branch === null) {
    return { state: { kind: "none" }, sha: null };
  }
  const found = await reader.get([...repo_segments(ctx.info.repo), "branches", ...branch.split("/")]);
  if (found.kind === "absent") {
    return { state: { kind: "missing" }, sha: null };
  }
  const commit = require_record(found.body, "GitHub branch").commit;
  const sha = sha_of(is_record(commit) ? commit.sha : null);
  if (sha === null) {
    throw new Error(`GitHub answered branch ${branch} of ${ctx.info.repo.owner}/${ctx.info.repo.name} without a commit sha`);
  }
  if (tracking === null) return { state: { kind: "unfetched" }, sha };
  if (sha === tracking) return { state: { kind: "same", sha }, sha };
  const compared = await reader.get([...repo_segments(ctx.info.repo), "compare", `${tracking}...${sha}`], { per_page: "1" });
  if (compared.kind === "absent") return { state: { kind: "rewritten" }, sha };
  const raw = require_record(compared.body, "GitHub compare");
  const ahead = count_of(raw.ahead_by);
  if (raw.status === "identical") return { state: { kind: "same", sha }, sha };
  if (raw.status === "ahead" && ahead !== null && ahead > 0) return { state: { kind: "remote_ahead", count: ahead }, sha };
  return { state: { kind: "rewritten" }, sha };
};

const pr_state = (raw: Record<string, unknown>): GithubPrState => {
  if (time_of(raw.merged_at) !== null) return "merged";
  if (raw.state === "closed") return "closed";
  return raw.draft === true ? "draft" : "open";
};

const logins = (value: unknown): string[] =>
  as_array(value).flatMap((entry) => (is_record(entry) && typeof entry.login === "string" ? [entry.login] : []));

const find_pr = async (reader: Reader, repo: GithubRepoRef, head: string): Promise<Record<string, unknown> | null> => {
  const found = await reader.get([...repo_segments(repo), "pulls"], { head, state: "all", sort: "created", direction: "desc", per_page: "1" });
  const first = found.kind === "ok" ? as_array(found.body)[0] : undefined;
  return is_record(first) ? first : null;
};

const parent_ref = (info: RepoInfo): GithubRepoRef | null => {
  const match = info.fork_parent === null ? null : slug_pattern.exec(info.fork_parent);
  return match?.[1] && match[2] ? { host: info.repo.host, owner: match[1], name: match[2] } : null;
};

const read_pr = async (ctx: RoundContext, reader: Reader, branch: string): Promise<FoundPr | null> => {
  const head = `${ctx.info.repo.owner}:${branch}`;
  const parent = parent_ref(ctx.info);
  let repo = ctx.info.repo;
  let raw = await find_pr(reader, repo, head);
  if (!raw && parent) {
    repo = parent;
    raw = await find_pr(reader, repo, head);
  }
  const number = raw ? count_of(raw.number) : null;
  if (!raw || number === null) {
    return null;
  }
  const state = pr_state(raw);
  let reviews: GithubReviews | null = null;
  if (state === "open" || state === "draft") {
    const pages = await reader.pages([...repo_segments(repo), "pulls", String(number), "reviews"], { per_page: "100" });
    const entries = pages.kind === "ok" ? pages.bodies.flatMap(as_array) : [];
    const read = entries.flatMap((entry) =>
      is_record(entry) && typeof entry.state === "string" ? [{ login: is_record(entry.user) && typeof entry.user.login === "string" ? entry.user.login : null, state: entry.state }] : [],
    );
    reviews = summarize_reviews(read, logins(raw.requested_reviewers), as_array(raw.requested_teams).length);
  }
  const head_commit = is_record(raw.head) ? sha_of(raw.head.sha) : null;
  return {
    pr: { number, title: text_of(raw.title) ?? `#${number}`, state, html_url: web_link(raw.html_url, ctx.info.repo.host), reviews },
    head_sha: head_commit,
    repo,
  };
};

const check_of = (name: unknown, state: GithubCheck["state"], url: unknown, host: string, started: unknown, completed: unknown): GithubCheck | null => {
  const label = text_of(name);
  return label === null ? null : { name: label, state, url: web_link(url, host), started_at: time_of(started), completed_at: time_of(completed) };
};

const state_of = (run: Record<string, unknown>): GithubCheck["state"] | null =>
  typeof run.status === "string" ? run_state({ status: run.status, conclusion: typeof run.conclusion === "string" ? run.conclusion : null }) : null;

const listed = (pages: GotPages, key: string): { items: Record<string, unknown>[]; total: number } => {
  if (pages.kind !== "ok") {
    return { items: [], total: 0 };
  }
  const records = pages.bodies.filter(is_record);
  return { items: records.flatMap((page) => as_array(page[key]).filter(is_record)), total: count_of(records[0]?.total_count) ?? 0 };
};

const read_checks = async (reader: Reader, repo: GithubRepoRef, sha: string): Promise<GithubChecks | null> => {
  const base = [...repo_segments(repo), "commits", sha];
  const { host } = repo;
  const runs = listed(await reader.pages([...base, "check-runs"], { per_page: "100" }), "check_runs");
  const statuses = listed(await reader.pages([...base, "status"], { per_page: "100" }), "statuses");
  const workflows = listed(await reader.pages([...repo_segments(repo), "actions", "runs"], { head_sha: sha, per_page: "100" }), "workflow_runs");
  const check_runs = runs.items.flatMap((run): CheckRun[] => {
    const state = state_of(run);
    const check = state && check_of(run.name, state, run.html_url, host, run.started_at, run.completed_at);
    return check ? [{ check, app: is_record(run.app) && typeof run.app.slug === "string" ? run.app.slug : null }] : [];
  });
  const status_checks = statuses.items.flatMap((entry) => {
    const check = typeof entry.state === "string" && check_of(entry.context, status_state(entry.state), entry.target_url, host, null, null);
    return check ? [check] : [];
  });
  const workflow_checks = workflows.items.flatMap((run) => {
    const state = state_of(run);
    const check = state && check_of(run.name, state, run.html_url, host, run.run_started_at, run.status === "completed" ? run.updated_at : null);
    return check ? [check] : [];
  });
  const limited = runs.total > runs.items.length || workflows.total > workflows.items.length;
  return summarize_checks({ check_runs, statuses: status_checks, workflows: workflow_checks, limited });
};

export const read_round = async (ctx: RoundContext): Promise<RoundRead> => {
  const reader = reader_of(ctx);
  try {
    const branch = await read_branch(ctx, reader);
    const found = ctx.target.branch === null ? null : await read_pr(ctx, reader, ctx.target.branch);
    const head = found?.head_sha ? { repo: found.repo, sha: found.head_sha } : branch.sha ? { repo: ctx.info.repo, sha: branch.sha } : null;
    const checks = head === null ? null : await read_checks(reader, head.repo, head.sha);
    return { kind: "data", branch: branch.state, pr: found?.pr ?? null, checks, remote_sha: branch.sha };
  } catch (error) {
    if (error instanceof RoundStopped) return error.read;
    throw error;
  }
};
