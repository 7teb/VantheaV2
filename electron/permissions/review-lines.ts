import type { HumanDecision } from "../../shared/approval.ts";
import type { ToolStep } from "../../shared/chat.ts";
import type { ReviewActor, ReviewRecord } from "../../shared/review.ts";
import { head_tail } from "./review-budget.ts";
import { blocking_statuses, review_statuses, type ReviewStatus } from "./review-prompt.ts";
import { actor_label, visible_to } from "./script-retention.ts";

export type FeedSource = { records: ReviewRecord[]; decisions: HumanDecision[]; steps: ToolStep[] };

export type FeedLine = {
  id: string;
  key: string;
  at: number;
  status: ReviewStatus;
  blocking: boolean;
  own_allow: boolean;
  tool: string;
  action: string;
  cwd: string;
  agent: string | null;
  record: ReviewRecord | null;
  fields: Record<string, unknown>;
};

export type TextClip = { action: number; reason: number; feedback: number };

const full_clip: TextClip = { action: 2000, reason: 600, feedback: 1000 };

export const short_clip: TextClip = { action: 500, reason: 300, feedback: 300 };

const command_names = new Set(["run_command", "start_background_task"]);

const decision_label = (decision: HumanDecision): string => {
  if (!decision.actor_id || decision.actor_id === "main") {
    return decision.actor || "main";
  }
  return actor_label({ id: decision.actor_id, name: decision.actor, kind: "agent" });
};

const dedupe = <T extends { id: string }>(entries: T[]): T[] => [...new Map(entries.map((entry) => [entry.id, entry])).values()];

const record_status = (record: ReviewRecord, answer: HumanDecision | undefined, steps: ToolStep[]): ReviewStatus => {
  if (record.verdict === "allow") {
    return record.granted ? review_statuses.granted : review_statuses.allowed;
  }
  if (record.verdict === "deny") {
    return record.source === "floor" ? review_statuses.blocked : review_statuses.review_denied;
  }
  if (answer) {
    return answer.approved ? review_statuses.approved : review_statuses.user_denied;
  }
  const waiting = steps.some((step) => step.status === "awaiting_approval" && step.reviews?.some((entry) => entry.id === record.id));
  return waiting ? review_statuses.waiting : review_statuses.unanswered;
};

const spoke_since = (mark: string | null, anchor: string | null): boolean => (anchor === null ? mark !== null : mark !== anchor);

export const decision_feed = (source: FeedSource, self: ReviewActor, mark: string | null, clip: TextClip = full_clip): FeedLine[] => {
  const records = dedupe(source.records);
  const decisions = dedupe(source.decisions);
  const answers = new Map(decisions.flatMap((decision) => (decision.review_id ? [[decision.review_id, decision] as const] : [])));
  const merged = new Set(records.map((record) => record.id));
  const items = [
    ...records.map((record) => ({ at: record.at, record, decision: answers.get(record.id) ?? null, line: true })),
    ...decisions.map((decision) => ({ at: decision.at, record: null, decision, line: !decision.review_id || !merged.has(decision.review_id) })),
  ];
  const numbered = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.at - b.item.at || a.index - b.index)
    .map(({ item }, index) => ({ ...item, id: `d${index + 1}` }));
  const lines: FeedLine[] = [];
  for (const entry of numbered) {
    if (!entry.line) continue;
    const { record, decision } = entry;
    if (record && !visible_to(record, self)) continue;
    const status = record ? record_status(record, decision ?? undefined, source.steps) : decision?.approved ? review_statuses.approved : review_statuses.user_denied;
    const anchor = decision ? decision.id : (record?.last_human_id ?? null);
    const human_spoke_since = spoke_since(mark, anchor);
    const tool = record?.tool ?? decision?.tool ?? "";
    const action = record?.subject ?? decision?.subject ?? "";
    const cwd = record?.cwd ?? decision?.cwd ?? "";
    const own = record ? record.actor.id === self.id : (decision?.actor_id ?? "main") === self.id;
    const agent = own ? null : record ? actor_label(record.actor) : decision ? decision_label(decision) : null;
    const reason = record?.reason ?? decision?.reason ?? "";
    const fields: Record<string, unknown> = {
      id: entry.id,
      by: record ? actor_label(record.actor) : decision ? decision_label(decision) : "main",
      tool,
      action: head_tail(action, clip.action),
      cwd,
      status,
      reason: reason.slice(0, clip.reason),
      ...(record?.rule ? { rule: record.rule } : {}),
      ...(decision?.feedback ? { feedback: decision.feedback.slice(0, clip.feedback) } : {}),
      ...(decision?.approved && decision.grant === "prefix" && decision.grant_prefix ? { grant: "prefix", prefix: decision.grant_prefix } : {}),
      human_spoke_since,
    };
    lines.push({
      id: entry.id,
      key: record?.id ?? decision?.id ?? "",
      at: entry.at,
      status,
      blocking: !human_spoke_since && blocking_statuses.includes(status),
      own_allow: own && record?.verdict === "allow",
      tool,
      action,
      cwd,
      agent,
      record,
      fields,
    });
  }
  return lines;
};

export const feed_text = (line: FeedLine): string => JSON.stringify(line.fields);

export type ActionLine = { key: string; kind: "command" | "write" | "other"; text: string; path_only: string };

const write_chars = 4000;

const arg_chars = 600;

const command_chars = 300;

const string_arg = (args: Record<string, unknown>): string => {
  const first = Object.values(args).find((value) => typeof value === "string");
  return typeof first === "string" ? first : JSON.stringify(args);
};

export const action_lines = (steps: ToolStep[], feed: FeedLine[], current_call: string): ActionLine[] => {
  const by_record = new Map(feed.flatMap((line) => (line.record ? [[line.record.id, line.id] as const] : [])));
  const pending = (step: ToolStep) => step.call_id === current_call && (step.status === "running" || step.status === "awaiting_approval");
  const visible = steps.filter((step) => !pending(step) && step.status !== "drafting" && step.status !== "queued");
  const writes = visible.filter((step) => step.name === "write_file" || step.name === "replace_in_file").slice(-10);
  return visible.map((step) => {
    if (command_names.has(step.name)) {
      const command = typeof step.args.command === "string" ? step.args.command : "";
      const last = step.reviews?.at(-1);
      const exit = step.view?.kind === "command" ? step.view.exit_code : null;
      const text = JSON.stringify({
        tool: step.name,
        command: command.length > command_chars ? `${command.slice(0, command_chars)}…` : command,
        ...(last && by_record.has(last.id) ? { decision: by_record.get(last.id) } : {}),
        status: step.status,
        ...(exit === null ? {} : { exit }),
      });
      return { key: step.id, kind: "command", text, path_only: text };
    }
    if (step.name === "write_file" || step.name === "replace_in_file") {
      const target = typeof step.args.path === "string" ? step.args.path : "";
      const body = step.name === "write_file" ? step.args.content : step.args.new_string;
      const content = typeof body === "string" ? body : "";
      const base = { tool: step.name, path: target, ...(step.name === "write_file" ? { chars: content.length } : {}), status: step.status };
      const path_only = JSON.stringify(base);
      const text = writes.includes(step) && content ? JSON.stringify({ ...base, text: head_tail(content, write_chars) }) : path_only;
      return { key: step.id, kind: "write", text, path_only };
    }
    const arg = string_arg(step.args);
    const text = JSON.stringify({ tool: step.name, arg: arg.length > arg_chars ? `${arg.slice(0, arg_chars)}…` : arg, status: step.status });
    return { key: step.id, kind: "other", text, path_only: text };
  });
};
