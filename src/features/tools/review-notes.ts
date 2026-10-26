import type { ApprovalRequest, HumanDecision } from "../../../shared/approval.ts";
import type { ToolStep } from "../../../shared/chat.ts";
import { review_deadline_ms, type ReviewNote, type ReviewRaise, type ReviewRecord, type RuleSource } from "../../../shared/review.ts";
import type { MessageKey, Translate } from "../../i18n/translate.ts";

export type NoteTone = "plain" | "waiting" | "reason" | "detail";

export type NoteLine = { text: string; tone: NoteTone };

export type OutcomeNote = { title: string; lines: NoteLine[] };

export type StepOutcome = { notice: OutcomeNote | null; footer: string[] };

const source_keys: Record<Exclude<RuleSource, "none">, MessageKey> = {
  custom_instructions: "review.source_custom_instructions",
  project_file: "review.source_project_file",
  human_message: "review.source_human_message",
};

const raise_order: ReviewRaise[] = ["plan", "protected", "script_floor"];

const line = (text: string, tone: NoteTone = "plain"): NoteLine => ({ text, tone });

const first_of = (entries: string[] | undefined): string => {
  const list = entries ?? [];
  return list.length > 1 ? `${list[0]} (+${list.length - 1})` : (list[0] ?? "");
};

const rule_text = (t: Translate, review: Pick<ReviewRecord, "rule_source" | "rule">): string | null =>
  review.rule_source === "none" || !review.rule ? null : t("review.rule", { source: t(source_keys[review.rule_source]), x: review.rule });

const raise_text = (t: Translate, raise: ReviewRaise, note: ReviewNote): string => {
  switch (raise) {
    case "plan":
      return t("review.min_plan");
    case "protected":
      return t("review.min_protected");
    case "script_floor":
      return t("review.min_script", { x: first_of(note.script_floor) });
  }
};

const failure_text = (t: Translate, note: ReviewNote): string => {
  const failure = note.failure ?? "unreadable";
  if (failure === "timeout") {
    return t("review.failure_timeout", { n: review_deadline_ms / 1000 });
  }
  return t(`review.failure_${failure}`);
};

const note_lines = (t: Translate, note: ReviewNote | null | undefined): NoteLine[] => {
  if (!note || note.source === "floor") {
    return [];
  }
  if (note.source === "unavailable") {
    return [line(t("review.unavailable_title"), "waiting"), line(failure_text(t, note))];
  }
  const raised = raise_order.filter((raise) => note.raised_by?.includes(raise)).map((raise) => line(raise_text(t, raise, note)));
  const rule = rule_text(t, note);
  return [...raised, line(t("review.reason", { x: note.reason || t("review.no_reason") })), ...(rule ? [line(rule)] : [])];
};

export const approval_lines = (t: Translate, request: ApprovalRequest): NoteLine[] => {
  switch (request.kind) {
    case "command": {
      const rechecked = request.rechecked ? [line(t("review.scripts_changed"))] : [];
      const plan = request.plan_rule ? [line(t("review.min_plan"))] : [];
      return [...rechecked, ...plan, ...note_lines(t, request.review)];
    }
    case "mcp": {
      const rechecked = request.rechecked ? [line(t("review.scripts_changed"))] : [];
      const reason = !request.review && request.reason ? [line(request.reason)] : [];
      return [...rechecked, ...note_lines(t, request.review), ...reason];
    }
    case "write":
      return request.instruction_file ? [line(t("review.min_instruction_file"))] : [];
    case "memory":
    case "mcp_server":
    case "skill_install":
    case "agent_message":
    case "secret_read":
      return note_lines(t, request.review);
  }
};

const denied_notice = (t: Translate, current: ReviewRecord | null, decision: HumanDecision | null): OutcomeNote | null => {
  if (decision && !decision.approved) {
    const reason = current?.source === "model" && current.reason ? [line(decision.expired ? current.reason : t("review.reason", { x: current.reason }), "reason")] : [];
    const feedback = decision.feedback.trim() ? [line(t("review.feedback", { x: decision.feedback.trim() }), "detail")] : [];
    return { title: decision.expired ? t("review.denied") : t("review.denied_by_you"), lines: [...reason, ...feedback] };
  }
  if (!current || current.verdict !== "deny" || current.source !== "model") {
    return null;
  }
  return {
    title: t(current.earlier ? "review.workaround" : "review.denied"),
    lines: [line(current.reason || t("review.no_reason"), "reason")],
  };
};

const ran_footer = (t: Translate, current: ReviewRecord | null, decision: HumanDecision | null): string[] => {
  if (current?.granted && current.grant_prefixes?.length) {
    return [t("review.allowed_prefix", { x: current.grant_prefixes.join(", ") })];
  }
  if (!decision?.approved) {
    return [];
  }
  return [t(current?.source === "unavailable" ? "review.approved_unavailable" : "review.approved")];
};

export const step_outcome = (t: Translate, step: ToolStep): StepOutcome => {
  const current = (step.reviews ?? []).findLast((record) => !record.superseded) ?? null;
  const decisions = step.decisions ?? [];
  const decision = (current ? decisions.findLast((entry) => entry.review_id === current.id) : decisions.at(-1)) ?? null;
  switch (step.status) {
    case "denied":
      return { notice: denied_notice(t, current, decision), footer: [] };
    case "failed":
      if (current?.source === "floor") {
        return { notice: { title: t("review.blocked"), lines: [line(current.reason, "reason")] }, footer: [] };
      }
      return { notice: null, footer: ran_footer(t, current, decision) };
    case "done":
      return { notice: null, footer: ran_footer(t, current, decision) };
    default:
      return { notice: null, footer: [] };
  }
};
