export type GithubRepoRef = { host: string; owner: string; name: string };

export type GithubTrouble = "offline" | "rate_limited" | "server_error";

export type GithubStale = { reason: GithubTrouble; reset_at: string | null; status: number | null };

export type GithubCli = { state: "missing" | "too_old" | "signed_out" | "ready"; version: string | null };

export type GithubBranch =
  | { kind: "same"; sha: string }
  | { kind: "remote_ahead"; count: number }
  | { kind: "rewritten" }
  | { kind: "missing" }
  | { kind: "unfetched" }
  | { kind: "none" };

export type GithubReviews = { approved: number; changes_requested: number; pending: number };

export type GithubPrState = "open" | "draft" | "merged" | "closed";

export type GithubPr = { number: number; title: string; state: GithubPrState; html_url: string | null; reviews: GithubReviews | null };

export type GithubCheckState = "failed" | "action_required" | "running" | "passed" | "skipped";

export type GithubCheck = { name: string; state: GithubCheckState; url: string | null; started_at: string | null; completed_at: string | null };

export type GithubChecks = { state: GithubCheckState; counts: Record<GithubCheckState, number>; items: GithubCheck[]; limited: boolean };

export type GithubData = {
  kind: "data";
  repo: GithubRepoRef;
  html_url: string | null;
  default_branch: string | null;
  visibility: "public" | "private" | "internal" | null;
  archived: boolean;
  fork_parent: string | null;
  renamed_from: string | null;
  branch: GithubBranch;
  pr: GithubPr | null;
  checks: GithubChecks | null;
  source: "gh" | "anonymous";
  source_login: string | null;
  updated_at: string;
  stale: GithubStale | null;
};

export type GithubRepoView =
  | { kind: "none" }
  | { kind: "loading"; repo: GithubRepoRef }
  | { kind: "cli_host"; repo: GithubRepoRef; cli: GithubCli; command: string | null }
  | { kind: "needs_sign_in"; repo: GithubRepoRef; reason: "not_readable" | "expired"; cli: GithubCli; command: string | null }
  | { kind: "no_access"; repo: GithubRepoRef; login: string; command: string }
  | { kind: "sso"; repo: GithubRepoRef; org: string; url: string }
  | { kind: "unavailable"; repo: GithubRepoRef; reason: GithubTrouble; reset_at: string | null; status: number | null; cli: GithubCli | null; command: string | null }
  | GithubData;
