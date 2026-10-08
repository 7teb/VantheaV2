import { permission_intent } from "../../permissions/context.ts";
import { command_sources, decide_command } from "../../permissions/decide.ts";
import { command_input } from "../../permissions/review.ts";
import { command_sleep_reason, rejected_text } from "../../permissions/sleep.ts";
import type { ToolContext } from "../types.ts";

export type GateOutcome = { kind: "run" } | { kind: "block"; reason: string } | { kind: "denied"; text: string };

export const gate_command = async (ctx: ToolContext, command: string, cwd: string, background: boolean): Promise<GateOutcome> => {
  ctx.signal.throwIfAborted();
  const sleep = command_sleep_reason(ctx, command);
  if (sleep) {
    return { kind: "denied", text: rejected_text(sleep) };
  }
  let input = await command_input(ctx, command, cwd, background);
  let decision = await decide_command(input, ctx.side_model, ctx.signal);
  if (decision.action === "run" && (decision.source === "model" || decision.source === "cache") && permission_intent(ctx) !== input.authorization) {
    input = await command_input(ctx, command, cwd, background);
    decision = await decide_command(input, ctx.side_model, ctx.signal);
  }
  if (decision.action === "block") {
    return { kind: "block", reason: decision.reason };
  }
  if (decision.action === "deny") {
    return { kind: "denied", text: decision.reason };
  }
  if (decision.action === "run") {
    return { kind: "run" };
  }
  const answer = await ctx.approve({
    kind: "command",
    command,
    cwd,
    background,
    overseer: { safe: false, reason: decision.reason },
    grant_prefix: decision.grant_prefix,
    ...(decision.source_hash ? { source_hash: decision.source_hash } : {}),
  });
  ctx.signal.throwIfAborted();
  if (!answer.approved) {
    return { kind: "denied", text: `The user denied this command.${answer.feedback ? ` User feedback: ${answer.feedback}` : ""}` };
  }
  if (decision.source_hash) {
    const current = await command_sources(input);
    if (current.hash !== decision.source_hash && current.catastrophic.length) {
      return {
        kind: "denied",
        text: `A script this command runs changed while the approval was open and now contains a destructive system operation (${current.catastrophic.join("; ")}). The command was not executed.`,
      };
    }
  }
  return { kind: "run" };
};

export const blocked_text = (reason: string) =>
  `Blocked (${reason}). This command never runs inside the app and cannot be approved here. Do not retry it or a variant; tell the user what you intended so they can run it themselves.`;
