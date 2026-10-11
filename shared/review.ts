export const review_verdicts = ["allow", "review", "deny"] as const;

export type ReviewVerdict = (typeof review_verdicts)[number];

export const rule_sources = ["none", "custom_instructions", "project_file", "human_message"] as const;

export type RuleSource = (typeof rule_sources)[number];

export type ReviewAnswer = {
  rule_source: RuleSource;
  rule: string;
  workaround_of: string;
  script_summary: string;
  reason: string;
  decision: ReviewVerdict;
};

export const actor_kinds = ["main", "agent"] as const;

export type ReviewActor = { id: string; name: string; kind: (typeof actor_kinds)[number] };

export const review_sources = ["model", "floor", "unavailable"] as const;

export type ReviewSource = (typeof review_sources)[number];

export const review_raises = ["protected", "plan", "script_gap", "script_floor"] as const;

export type ReviewRaise = (typeof review_raises)[number];

export const review_failures = ["timeout", "network", "provider", "rate_limited", "auth", "credits", "refused", "too_large", "unreadable", "offline_window"] as const;

export type ReviewFailure = (typeof review_failures)[number];

export const earlier_statuses = ["user_denied", "review_denied", "blocked", "waiting"] as const;

export type ReviewEarlier = { action: string; status: (typeof earlier_statuses)[number]; agent: string | null };

export const review_deadline_ms = 30000;

export const script_roles = ["started", "named", "loaded", "manifest", "payload"] as const;

export type ScriptRole = (typeof script_roles)[number];

export const script_changes = ["written", "modified"] as const;

export type ReviewScript = {
  path: string;
  sha256: string | null;
  role: ScriptRole;
  chars: number;
  sent: boolean;
  summary: string | null;
  change: (typeof script_changes)[number] | null;
};

export type ReviewUsage = {
  prompt_tokens: number;
  estimated_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  cost: number | null;
  ms: number;
};

export type ReviewRecord = {
  id: string;
  at: number;
  actor: ReviewActor;
  tool: string;
  subject: string;
  cwd: string;
  verdict: ReviewVerdict;
  source: ReviewSource;
  reason: string;
  rule_source: RuleSource;
  rule: string;
  last_human_id: string | null;
  raised_by?: ReviewRaise[];
  granted?: boolean;
  circumvents?: string;
  earlier?: ReviewEarlier;
  grant_prefixes?: string[];
  failure?: ReviewFailure;
  scripts?: ReviewScript[];
  superseded?: "scripts_changed";
  usage?: ReviewUsage;
};

export type ReviewNote = Pick<ReviewRecord, "id" | "source" | "reason" | "rule_source" | "rule" | "raised_by" | "granted" | "circumvents" | "failure"> & {
  gaps?: string[];
  script_floor?: string[];
  offline_until?: number;
};
