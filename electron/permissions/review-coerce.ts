import {
  actor_kinds,
  earlier_statuses,
  review_failures,
  review_raises,
  review_sources,
  review_verdicts,
  rule_sources,
  script_changes,
  script_roles,
  type ReviewActor,
  type ReviewEarlier,
  type ReviewRecord,
  type ReviewScript,
  type ReviewUsage,
} from "../../shared/review.ts";
import { as_array, as_number, as_record, as_string } from "../storage/coerce.ts";

const member = <T extends string>(allowed: readonly T[], value: unknown): value is T => allowed.some((entry) => entry === value);

const is_count = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const string_or_null = (value: unknown): value is string | null => value === null || typeof value === "string";

const coerce_actor = (value: unknown): ReviewActor | null => {
  const { id, name, kind } = as_record(value);
  if (typeof id !== "string" || !id || typeof name !== "string" || !member(actor_kinds, kind)) {
    return null;
  }
  return { id, name, kind };
};

const coerce_script = (value: unknown): ReviewScript | null => {
  const { path, sha256, role, chars, sent, summary, change } = as_record(value);
  if (typeof path !== "string" || !path || !string_or_null(sha256) || !member(script_roles, role) || !is_count(chars)) {
    return null;
  }
  if (typeof sent !== "boolean" || !string_or_null(summary) || !(change === null || member(script_changes, change))) {
    return null;
  }
  return { path, sha256, role, chars, sent, summary, change };
};

const coerce_earlier = (value: unknown): ReviewEarlier | null => {
  const { action, status, agent } = as_record(value);
  if (typeof action !== "string" || !member(earlier_statuses, status) || !string_or_null(agent)) {
    return null;
  }
  return { action, status, agent };
};

const coerce_usage = (value: unknown): ReviewUsage | null => {
  const { prompt_tokens, estimated_tokens, cached_tokens, cache_write_tokens, completion_tokens, reasoning_tokens, cost, ms } = as_record(value);
  if (!is_count(prompt_tokens) || !is_count(estimated_tokens) || !is_count(cached_tokens) || !is_count(cache_write_tokens)) {
    return null;
  }
  if (!is_count(completion_tokens) || !is_count(reasoning_tokens) || !(cost === null || is_count(cost)) || !is_count(ms)) {
    return null;
  }
  return { prompt_tokens, estimated_tokens, cached_tokens, cache_write_tokens, completion_tokens, reasoning_tokens, cost, ms };
};

const dropped_record = (chat_id: string, call_id: string, problem: string): null => {
  console.warn(`[reviews] dropped a review record in chat ${chat_id}, step ${call_id}: ${problem}`);
  return null;
};

const present_list = <T>(value: unknown, read: (entry: unknown) => T | null): { entries: T[]; malformed: boolean } => {
  if (value === undefined) {
    return { entries: [], malformed: false };
  }
  const entries = as_array(value).flatMap((entry) => {
    const read_entry = read(entry);
    return read_entry === null ? [] : [read_entry];
  });
  return { entries, malformed: !Array.isArray(value) || entries.length !== value.length };
};

export const coerce_review = (value: unknown, chat_id: string, call_id: string): ReviewRecord | null => {
  const raw = as_record(value);
  const { id, subject, verdict } = raw;
  const actor = coerce_actor(raw.actor);
  if (typeof id !== "string" || !id) {
    return dropped_record(chat_id, call_id, "no id");
  }
  if (!actor) {
    return dropped_record(chat_id, call_id, `record ${id} has no valid actor`);
  }
  if (!member(review_verdicts, verdict)) {
    return dropped_record(chat_id, call_id, `record ${id} has no valid verdict`);
  }
  if (typeof subject !== "string") {
    return dropped_record(chat_id, call_id, `record ${id} has no subject`);
  }
  const record: ReviewRecord = {
    id,
    at: as_number(raw.at, 0),
    actor,
    tool: as_string(raw.tool),
    subject,
    cwd: as_string(raw.cwd),
    verdict,
    source: member(review_sources, raw.source) ? raw.source : "model",
    reason: as_string(raw.reason),
    rule_source: member(rule_sources, raw.rule_source) ? raw.rule_source : "none",
    rule: as_string(raw.rule),
    last_human_id: typeof raw.last_human_id === "string" ? raw.last_human_id : null,
  };
  const dropped: string[] = [];
  const raised_by = present_list(raw.raised_by, (entry) => (member(review_raises, entry) ? entry : null));
  if (raised_by.malformed) {
    dropped.push("raised_by");
  }
  if (raised_by.entries.length) {
    record.raised_by = raised_by.entries;
  }
  const scripts = present_list(raw.scripts, coerce_script);
  if (scripts.malformed) {
    dropped.push("scripts");
  }
  if (scripts.entries.length) {
    record.scripts = scripts.entries;
  }
  if (typeof raw.granted === "boolean") {
    record.granted = raw.granted;
  } else if (raw.granted !== undefined) {
    dropped.push("granted");
  }
  if (typeof raw.circumvents === "string" && raw.circumvents) {
    record.circumvents = raw.circumvents;
  } else if (raw.circumvents !== undefined) {
    dropped.push("circumvents");
  }
  const earlier = raw.earlier === undefined ? null : coerce_earlier(raw.earlier);
  if (earlier) {
    record.earlier = earlier;
  } else if (raw.earlier !== undefined) {
    dropped.push("earlier");
  }
  const grant_prefixes = present_list(raw.grant_prefixes, (entry) => (typeof entry === "string" && entry ? entry : null));
  if (grant_prefixes.malformed) {
    dropped.push("grant_prefixes");
  }
  if (grant_prefixes.entries.length) {
    record.grant_prefixes = grant_prefixes.entries;
  }
  if (member(review_failures, raw.failure)) {
    record.failure = raw.failure;
  } else if (raw.failure !== undefined) {
    dropped.push("failure");
  }
  if (raw.superseded === "scripts_changed") {
    record.superseded = raw.superseded;
  } else if (raw.superseded !== undefined) {
    dropped.push("superseded");
  }
  const usage = raw.usage === undefined ? null : coerce_usage(raw.usage);
  if (usage) {
    record.usage = usage;
  } else if (raw.usage !== undefined) {
    dropped.push("usage");
  }
  if (dropped.length) {
    console.warn(`[reviews] review record ${id} in chat ${chat_id}, step ${call_id}: dropped malformed ${dropped.join(", ")}`);
  }
  return record;
};

export const coerce_reviews = (value: unknown, chat_id: string, call_id: string): ReviewRecord[] => {
  if (!Array.isArray(value)) {
    console.warn(`[reviews] dropped the review list in chat ${chat_id}, step ${call_id}: not a list`);
    return [];
  }
  return value.flatMap((entry) => {
    const record = coerce_review(entry, chat_id, call_id);
    return record ? [record] : [];
  });
};
