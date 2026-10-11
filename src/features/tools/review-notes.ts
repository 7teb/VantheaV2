import type { ApprovalRequest, HumanDecision } from "../../../shared/approval.ts";
import type { ToolStep } from "../../../shared/chat.ts";
import { review_deadline_ms, type ReviewEarlier, type ReviewNote, type ReviewRaise, type ReviewRecord, type RuleSource } from "../../../shared/review.ts";
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

const status_keys: Record<ReviewEarlier["status"], MessageKey> = {
  user_denied: "review.status_denied_by_you",
  review_denied: "review.status_denied_by_review",
  blocked: "review.status_blocked",
  waiting: "review.status_waiting",
};

const raise_order: ReviewRaise[] = ["plan", "protected", "script_floor", "script_gap"];

const line = (text: string, tone: NoteTone = "plain"): NoteLine => ({ text, tone });

const first_of = (entries: string[] | undefined): string => {
  const list = entries ?? [];
  return list.length > 1 ? `${list[0]} (+${list.length - 1})` : (list[0] ?? "");
};

const clock_time = (at: number): string => {
  const date = new Date(at);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((value) => String(value).padStart(2, "0")).join(":");
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
    case "script_gap":
      return t("review.min_gap", { x: first_of(note.gaps) });
  }
};

const failure_text = (t: Translate, note: ReviewNote): string => {
  const failure = note.failure ?? "unreadable";
  if (failure === "timeout") {
    return t("review.failure_timeout", { n: review_deadline_ms / 1000 });
  }
  if (failure === "offline_window") {
    return t("review.failure_offline_window", { time: clock_time(note.offline_until ?? Date.now()) });
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
    case "mcp_server":
    case "skill_install":
    case "memory":
    case "browser_vision":
      return [];
  }
};

const earlier_text = (t: Translate, earlier: ReviewEarlier): string => {
  const status = t(status_keys[earlier.status]);
  return earlier.agent ? t("review.earlier_agent", { name: earlier.agent, x: earlier.action, status }) : t("review.earlier", { x: earlier.action, status });
};

const denied_notice = (t: Translate, current: ReviewRecord | null, decision: HumanDecision | null): OutcomeNote | null => {
  if (decision && !decision.approved) {
    const reason = current?.source === "model" && current.reason ? [line(t("review.reason", { x: current.reason }), "reason")] : [];
    const feedback = decision.feedback.trim() ? [line(t("review.feedback", { x: decision.feedback.trim() }), "detail")] : [];
    return { title: t("review.denied_by_you"), lines: [...reason, ...feedback] };
  }
  if (!current || current.verdict !== "deny" || current.source !== "model") {
    return null;
  }
  const rule = rule_text(t, current);
  return {
    title: t(current.earlier ? "review.workaround" : "review.denied"),
    lines: [
      ...(current.earlier ? [line(earlier_text(t, current.earlier), "detail")] : []),
      line(current.reason || t("review.no_reason"), "reason"),
      ...(rule ? [line(rule, "detail")] : []),
    ],
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
