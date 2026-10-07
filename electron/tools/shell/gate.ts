import { decide_command } from "../../permissions/decide.ts";
import { record_grant } from "../../permissions/grants.ts";
import { command_input, review_matches } from "../../permissions/review.ts";
import { command_sleep_reason, rejected_text } from "../../permissions/sleep.ts";
import type { ToolContext } from "../types.ts";

export type GateOutcome = { kind: "run" } | { kind: "block"; reason: string } | { kind: "denied"; text: string };

export const gate_command = async (ctx: ToolContext, command: string, cwd: string, background: boolean): Promise<GateOutcome> => {
  ctx.signal.throwIfAborted();
  const sleep = command_sleep_reason(ctx, command);
  if (sleep) return { kind: "denied", text: rejected_text(sleep) };
  const decision = await decide_command(command_input(ctx, command, cwd), ctx.side_model, ctx.signal);
  if (decision.action === "block") return { kind: "block", reason: decision.reason };
  const changed = async (): Promise<GateOutcome | null> => {
    if (await review_matches(ctx, command, cwd, decision)) return null;
    return { kind: "denied", text: "The human instructions or inspected script changed during review. The command was not executed." };
  };
  if (decision.action === "run") return await changed() ?? { kind: "run" };
  if (ctx.mode === "auto") return { kind: "denied", text: rejected_text(decision.reason) };
  const answer = await ctx.approve({
    kind: "command", command, cwd, background, overseer: decision.verdict ?? { safe: false, reason: decision.reason }, grant_prefix: decision.grant_prefix,
  });
  ctx.signal.throwIfAborted();
  if (!answer.approved) {
    return { kind: "denied", text: "The user denied this command." + (answer.feedback ? " User feedback: " + answer.feedback : "") };
  }
  const stale = await changed();
  if (stale) return stale;
  record_grant({ chat_id: ctx.chat_id, project_root: ctx.project_root, scope: answer.grant, prefix: decision.grant_prefix, context: decision.context });
  return { kind: "run" };
};

export const blocked_text = (reason: string) =>
  "Blocked (" + reason + "). This command never runs inside the app and cannot be approved here. Do not retry it or a variant; tell the user what you intended so they can run it themselves.";
