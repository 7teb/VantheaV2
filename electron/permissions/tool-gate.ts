import type { ReviewNote, ReviewRecord } from "../../shared/review.ts";
import { get_settings } from "../settings/store.ts";
import type { ToolContext } from "../tools/types.ts";
import { review_and_record } from "./command-review.ts";
import { review_note } from "./decide.ts";
import { effective_mode } from "./full-window.ts";
import type { ActionCall } from "./review-action.ts";
import { review_verdict } from "./review-verdict.ts";
import { deny_text, workaround_text } from "./verdict-text.ts";

export type ToolGate = { kind: "run" } | { kind: "ask"; note: ReviewNote | null } | { kind: "denied"; text: string; reason: string };

export type GateOptions = { review_in_ask?: boolean };

export type CallReview = { record: ReviewRecord; note: ReviewNote; text: string; seen: ReadonlySet<string> };

export const review_call = async (ctx: ToolContext, tool: string, cwd: string, subject: string, call: ActionCall, granted: boolean): Promise<CallReview> => {
  const verdict = await review_verdict({
    reviewer: ctx.review,
    raised: [],
    granted,
    signal: ctx.signal,
    input: {
      chat_id: ctx.chat_id,
      project_root: ctx.project_root,
      custom_instructions: get_settings().custom_instructions,
      actor: ctx.review.actor,
      profile: ctx.review.actor.kind === "agent" ? ctx.profile : null,
      delegated_task: ctx.delegated_task ?? null,
      decisions: (await ctx.human_decisions?.()) ?? [],
      call_id: ctx.call_id,
      action: { tool, cwd, background: false, subject, call, files: [], gaps: [], changed: [], programs: [], notes: [], shell: "unknown" },
    },
  });
  const { record } = verdict;
  const text = record.verdict !== "deny" ? "" : record.earlier ? workaround_text("tool call", record, record.earlier) : deny_text("tool call", record);
  return { record, note: review_note(record), text, seen: verdict.seen };
};

export const tool_gate = async (ctx: ToolContext, tool: string, subject: string, options: GateOptions = {}): Promise<ToolGate> => {
  if (!options.review_in_ask && effective_mode(ctx.chat_id, ctx.mode) === "ask") {
    return { kind: "ask", note: null };
  }
  const result = await review_and_record(ctx, () => review_call(ctx, tool, ctx.project_root, subject, { kind: "tool" }, false));
  if (result.record.verdict === "allow") {
    return { kind: "run" };
  }
  if (result.record.verdict === "deny") {
    return { kind: "denied", text: result.text, reason: result.record.reason };
  }
  return { kind: "ask", note: result.note };
};
