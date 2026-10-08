import type { OverseerVerdict } from "../../../shared/approval.ts";
import { permission_intent } from "../../permissions/context.ts";
import { decisions_text } from "../../permissions/decisions.ts";
import { max_action_chars, run_review } from "../../permissions/overseer.ts";
import type { ToolContext } from "../types.ts";
import type { McpCall } from "./decide.ts";

export const mcp_overseer = async (call: McpCall, ctx: ToolContext): Promise<OverseerVerdict> => {
  const args = JSON.stringify(call.args, null, 2);
  if (args.length > max_action_chars) {
    return { safe: false, reason: "The MCP arguments are too long for the safety check." };
  }
  const review = await run_review(
    ctx.side_model,
    {
      action: `MCP tool call ${call.server}/${call.tool} (risk tier ${call.tier}${call.trusted ? ", trusted server" : ""})\nArguments:\n${args}`,
      project_root: ctx.project_root,
      cwd: ctx.execution_cwd || ctx.project_root,
      authorization: permission_intent(ctx),
      delegated_task: ctx.delegated_task,
      decisions: decisions_text((await ctx.human_decisions?.()) ?? []),
    },
    ctx.signal,
  );
  return review.verdict;
};
