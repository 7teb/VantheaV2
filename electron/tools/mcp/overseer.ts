import { review_note } from "../../permissions/decide.ts";
import { review_verdict } from "../../permissions/review-verdict.ts";
import { deny_text, workaround_text } from "../../permissions/verdict-text.ts";
import { get_settings } from "../../settings/store.ts";
import { decision_tool, type McpReview } from "./decide.ts";

export const mcp_review: McpReview = async (call, ctx, granted) => {
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
      action: {
        tool: decision_tool(call),
        cwd: ctx.execution_cwd || ctx.project_root,
        background: false,
        subject: JSON.stringify(call.args, null, 2),
        mcp: { tier: call.tier, trusted: call.trusted },
        files: [],
        gaps: [],
        changed: [],
      },
    },
  });
  const { record } = verdict;
  const text = record.verdict !== "deny" ? "" : record.earlier ? workaround_text("tool call", record, record.earlier) : deny_text("tool call", record);
  return { record, note: review_note(record, ctx.chat_id), text, seen: verdict.seen };
};
