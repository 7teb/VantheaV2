import type { ShellKind } from "../../../shared/shell.ts";
import { reviewed_until_stable, type Settled } from "../../permissions/command-review.ts";
import type { CommandDecision } from "../../permissions/decide.ts";
import { effective_mode } from "../../permissions/full-window.ts";
import type { Dialect } from "../../permissions/statements.ts";
import { approved_note, not_approved_text } from "../../permissions/verdict-text.ts";
import type { ToolContext } from "../types.ts";

export type GateOutcome = Settled;

type GateCall = { command: string; cwd: string; background: boolean; shell: ShellKind };

const dialects: Record<ShellKind, Dialect> = { powershell: "powershell", bash: "posix" };

const settle_command = (ctx: ToolContext, call: GateCall) => async (decision: CommandDecision, rechecked: boolean): Promise<Settled> => {
  if (decision.action === "block") {
    return { kind: "block", reason: decision.reason };
  }
  if (decision.action === "deny") {
    return { kind: "denied", text: decision.reason, output: "" };
  }
  if (decision.action === "run") {
    return { kind: "run", note: null };
  }
  const answer = await ctx.approve({
    kind: "command",
    command: call.command,
    cwd: call.cwd,
    background: call.background,
    shell: call.shell,
    review: decision.note,
    grant_prefix: decision.grant_prefix,
    ...(decision.plan ? { plan: true } : {}),
    ...(decision.plan && effective_mode(ctx.chat_id, ctx.mode) === "full" ? { plan_rule: true } : {}),
    ...(decision.source_hash ? { source_hash: decision.source_hash } : {}),
    ...(rechecked ? { rechecked: true } : {}),
  });
  ctx.signal.throwIfAborted();
  if (!answer.approved) {
    const model_reason = decision.note?.source === "model" && decision.note.reason ? decision.note.reason : null;
    return { kind: "denied", text: not_approved_text("command", answer, model_reason), output: "" };
  }
  return { kind: "run", note: approved_note("command") };
};

export const gate_command = (ctx: ToolContext, command: string, cwd: string, background: boolean, shell: ShellKind = "powershell"): Promise<GateOutcome> =>
  reviewed_until_stable(ctx, { command, cwd, background, shell: dialects[shell] }, settle_command(ctx, { command, cwd, background, shell }));

export const blocked_text = (reason: string) =>
  `Blocked (${reason}). This command never runs inside the app and cannot be approved here. Do not retry it or a variant; tell the user what you intended so they can run it themselves.`;
