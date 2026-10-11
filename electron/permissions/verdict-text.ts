import type { ReviewEarlier, RuleSource } from "../../shared/review.ts";
import { review_statuses, type ReviewStatus } from "./review-prompt.ts";

export type Subject = "command" | "tool call";

export type ReviewedReason = { reason: string; rule_source: RuleSource; rule: string };

const source_names: Record<Exclude<RuleSource, "none">, string> = {
  custom_instructions: "the user's custom instructions",
  project_file: "the project instruction files",
  human_message: "a user message",
};

const action_chars = 300;

const lines = (...entries: (string | null)[]): string => entries.filter((entry): entry is string => entry !== null).join("\n");

const reason_line = (reason: string) => `Reason: ${reason.trim() || "none given."}`;

const rule_line = (review: ReviewedReason): string | null =>
  review.rule_source === "none" || !review.rule ? null : `Rule (${source_names[review.rule_source]}): "${review.rule}"`;

const earlier_status = (status: ReviewStatus): ReviewEarlier["status"] => {
  switch (status) {
    case review_statuses.user_denied:
    case review_statuses.repeat_denied:
      return "user_denied";
    case review_statuses.review_denied:
      return "review_denied";
    case review_statuses.blocked:
      return "blocked";
    default:
      return "waiting";
  }
};

const earlier_phrases: Record<ReviewEarlier["status"], string> = {
  user_denied: "the user denied",
  review_denied: "the automatic review denied",
  blocked: "the app blocks",
  waiting: "the user has not approved yet",
};

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max)}…`);

export const earlier_line = (action: string, status: ReviewStatus, agent: string | null): ReviewEarlier => ({ action: clip(action, action_chars), status: earlier_status(status), agent });

export const approved_note = (subject: Subject): string => `The user approved this ${subject}. The approval covers this exact ${subject} only.`;

export const user_denied_text = (subject: Subject, feedback: string, review_reason: string | null): string =>
  lines(
    `The user denied this ${subject}. It did not run.`,
    review_reason ? `Automatic review: ${review_reason}` : null,
    `User feedback: ${feedback.trim() || "none."}`,
    "Do not run it again and do not reach its result another way; that counts as deliberately working around the user's decision and is denied. Follow the feedback, or continue without this step and say in your reply if you still need it.",
  );

export const deny_text = (subject: Subject, review: ReviewedReason): string =>
  lines(
    `Denied by the automatic review. The ${subject} did not run.`,
    reason_line(review.reason),
    rule_line(review),
    "Do not run it again and do not get around this denial with another command, script, tool or agent; that counts as deliberately working around the review and is denied. If the reason or the rule names an allowed way, use that way. Otherwise stop and say in your reply what you need and why, so the user can decide.",
  );

export const workaround_text = (subject: Subject, review: ReviewedReason, earlier: ReviewEarlier): string =>
  lines(
    `Denied by the automatic review as a workaround. The ${subject} did not run.`,
    `It reaches the result of an earlier action that ${earlier_phrases[earlier.status]}: ${earlier.action}${earlier.agent ? ` (by ${earlier.agent})` : ""}`,
    reason_line(review.reason),
    rule_line(review),
    "The user has not said anything since, so this counts as deliberately working around that decision. Stop this approach and do not try it again in any form. Say in your reply what you were trying to do and why, so the user can decide.",
  );

export const stopped_text = (subject: Subject): string =>
  `Not run: the turn was stopped while this ${subject} waited for the user's approval. It is not approved. Unless a newer user message asks for it, ask the user before running it or anything with the same result.`;

export const scripts_changed_text = (paths: string[]): string =>
  `A script this command runs changed between review and execution three times (${paths.join(", ")}). The command was not executed. Run it again once nothing is writing to these files.`;
