import { review_call } from "../../permissions/tool-gate.ts";
import { decision_tool, type McpReview } from "./decide.ts";

export const mcp_review: McpReview = (call, ctx, granted) =>
  review_call(ctx, decision_tool(call), ctx.execution_cwd || ctx.project_root, JSON.stringify(call.args, null, 2), { kind: "mcp", tier: call.tier, trusted: call.trusted }, granted);
