import { decide_command } from "../../permissions/decide.ts";
import { record_grant } from "../../permissions/grants.ts";
import { command_input, report_permission, review_matches } from "../../permissions/review.ts";
import type { ToolContext } from "../types.ts";

export type GateOutcome = { kind: "run" } | { kind: "block"; reason: string } | { kind: "denied"; text: string };

export const gate_command = async (ctx: ToolContext, command: string, cwd: string, background: boolean): Promise<GateOutcome> => {
  const decision = await decide_command(command_input(ctx, command, cwd), ctx.side_model, ctx.signal);
  report_permission(ctx, decision);
  if (decision.action === "block") return { kind: "block", reason: decision.reason };
  const changed = async (): Promise<GateOutcome | null> => {
    if (await review_matches(ctx, command, cwd, decision)) return null;
    const reason = "The human instructions or inspected script changed during review. The command was not executed.";
    ctx.permission?.({ action: "deny", source: "changed", reason, ...decision.context });
    return { kind: "denied", text: reason };
  };
  if (decision.action === "run") return await changed() ?? { kind: "run" };
  const answer = await ctx.approve({
    kind: "command", command, cwd, background, overseer: decision.verdict ?? { safe: false, reason: decision.reason }, grant_prefix: decision.grant_prefix,
  });
  ctx.signal.throwIfAborted();
  if (!answer.approved) {
    const reason = "The user denied this command." + (answer.feedback ? " User feedback: " + answer.feedback : "");
    ctx.permission?.({ action: "deny", source: "approval", reason, ...decision.context });
    return { kind: "denied", text: reason };
  }
  const stale = await changed();
  if (stale) return stale;
  record_grant({ chat_id: ctx.chat_id, project_root: ctx.project_root, scope: answer.grant, prefix: decision.grant_prefix, context: decision.context });
  ctx.permission?.({ action: "run", source: "approval", reason: "The user approved this exact command and reviewed context.", ...decision.context });
  return { kind: "run" };
};

export const blocked_text = (reason: string) =>
  "Blocked (" + reason + "). This command never runs inside the app and cannot be approved here. Do not retry it or a variant; tell the user what you intended so they can run it themselves.";
