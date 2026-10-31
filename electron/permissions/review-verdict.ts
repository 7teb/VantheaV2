import { randomUUID } from "node:crypto";
import type { ReviewEarlier, ReviewRaise, ReviewRecord, ReviewScript, ReviewVerdict } from "../../shared/review.ts";
import type { Reviewer } from "../tools/types.ts";
import { same_subject } from "./decisions.ts";
import { run_review, type ReviewOutcome } from "./overseer.ts";
import { review_input, type InputRequest } from "./review-input.ts";
import { review_statuses } from "./review-prompt.ts";
import { request_cap_tokens } from "./review-budget.ts";
import { assemble_review } from "./review-request.ts";
import { instance_key } from "./review-state.ts";
import type { ScriptFile } from "./sources.ts";
import { earlier_line } from "./verdict-text.ts";

export type VerdictRequest = { reviewer: Reviewer; input: Omit<InputRequest, "model" | "records" | "steps" | "earlier_commands">; raised: ReviewRaise[]; granted: boolean; signal: AbortSignal };

export type VerdictResult = { record: ReviewRecord; seen: ReadonlySet<string> };

const rank: Record<ReviewVerdict, number> = { allow: 0, review: 1, deny: 2 };

const stricter = (a: ReviewVerdict, b: ReviewVerdict): ReviewVerdict => (rank[a] >= rank[b] ? a : b);

const review_scripts = (files: ScriptFile[], sent: ReadonlySet<string>, summary: string): ReviewScript[] =>
  files
    .filter((file) => file.role !== "payload" && file.path)
    .map((file) => ({
      path: file.path,
      sha256: file.sha256,
      role: file.role,
      chars: file.chars,
      sent: sent.has(file.id),
      summary: sent.has(file.id) ? summary || null : null,
      change: file.change?.kind ?? null,
    }));

export const review_verdict = async (request: VerdictRequest): Promise<VerdictResult> => {
  const { reviewer, signal } = request;
  const history = await reviewer.history();
  const input = await review_input({ ...request.input, model: reviewer.model, records: history.records, steps: history.steps, earlier_commands: history.earlier_commands });
  const room = (await reviewer.call.prompt_room?.()) ?? request_cap_tokens;
  const assembled = assemble_review(input, room);
  const instance = instance_key(request.input.chat_id, reviewer.actor.id);
  const outcome: ReviewOutcome = assembled.too_large ? { kind: "failure", failure: "too_large", usage: null } : await run_review(reviewer, instance, assembled, signal);
  const seen = new Set(history.records.map((record) => record.id));
  const scripts = review_scripts(request.input.action.files, assembled.sent, outcome.kind === "answer" ? outcome.answer.script_summary : "");
  const base = {
    id: randomUUID(),
    at: Date.now(),
    actor: reviewer.actor,
    tool: request.input.action.tool,
    subject: request.input.action.subject,
    cwd: request.input.action.cwd,
    last_human_id: input.mark,
    ...(scripts.length ? { scripts } : {}),
    ...(outcome.usage ? { usage: outcome.usage } : {}),
  };
  if (outcome.kind === "failure") {
    const record: ReviewRecord = { ...base, verdict: "review", source: "unavailable", reason: "", rule_source: "none", rule: "", failure: outcome.failure };
    return { record, seen };
  }
  const { answer } = outcome;
  const line = outcome.workaround ? assembled.lines.find((entry) => entry.id === outcome.workaround) : undefined;
  let model = answer.decision;
  let earlier: ReviewEarlier | null = null;
  let circumvents: string | null = null;
  if (line && model === "deny") {
    const asked_again =
      (line.status === review_statuses.waiting || line.status === review_statuses.unanswered) && same_subject(line.action, base.subject) && same_subject(line.cwd, base.cwd);
    if (asked_again) {
      model = "review";
    } else {
      circumvents = line.record?.id ?? line.key;
      earlier = earlier_line(line.action, line.status, line.agent);
    }
  }
  const raised = model === "deny" ? [] : request.raised;
  const verdict = stricter(model, request.raised.length ? "review" : "allow");
  const granted = verdict === "review" && model === "review" && !request.raised.length && request.granted;
  const record: ReviewRecord = {
    ...base,
    verdict: granted ? "allow" : verdict,
    source: "model",
    reason: answer.reason,
    rule_source: answer.rule_source,
    rule: answer.rule,
    ...(raised.length ? { raised_by: raised } : {}),
    ...(granted ? { granted: true } : {}),
    ...(circumvents ? { circumvents } : {}),
    ...(earlier ? { earlier } : {}),
  };
  return { record, seen };
};
