import type { CommandHandoff } from "../../../shared/ipc/work.ts";
import type { ShellKind } from "../../../shared/shell.ts";
import { adopt_background, type BackgroundStart } from "../../background/manager.ts";
import { estimate_tokens, result_cap_tokens } from "../../context/estimate.ts";
import type { ShellDetach, ShellOutcome } from "../../shell/run.ts";
import type { ToolContext, ToolResult } from "../types.ts";
import { background_view, task_name } from "./task-view.ts";

type Offer = { start: BackgroundStart; detach: ShellDetach };

const offers = new Map<string, Offer>();

const offer_key = (chat_id: string, call_id: string) => `${chat_id}\n${call_id}`;

type CallScope = Pick<ToolContext, "chat_id" | "turn_id" | "call_id" | "project_root">;

export const can_hand_off = (ctx: Pick<ToolContext, "profile">): boolean => ctx.profile === "main" || ctx.profile === "plan";

export const offer_handoff = (ctx: CallScope, run: Pick<BackgroundStart, "command" | "cwd" | "shell">, detach: ShellDetach): void => {
  const start: BackgroundStart = {
    chat_id: ctx.chat_id,
    turn_id: ctx.turn_id,
    project_root: ctx.project_root,
    cwd: run.cwd,
    name: task_name(run.command.split("\n")[0]),
    command: run.command,
    shell: run.shell,
  };
  offers.set(offer_key(ctx.chat_id, ctx.call_id), { start, detach });
};

export const withdraw_handoff = (ctx: CallScope): void => {
  offers.delete(offer_key(ctx.chat_id, ctx.call_id));
};

export const move_to_background = (chat_id: string, call_id: string): CommandHandoff => {
  const key = offer_key(chat_id, call_id);
  const offer = offers.get(key);
  if (!offer) {
    return { status: "finished" };
  }
  const outcome = adopt_background(offer.start, offer.detach);
  if (outcome.status !== "moved") {
    return outcome;
  }
  offers.delete(key);
  return { status: "moved", task_id: outcome.task.id };
};

export const moved_result = (command: string, shell: ShellKind, note: string | null, outcome: Extract<ShellOutcome, { kind: "detached" }>): ToolResult => {
  const seconds = (outcome.duration_ms / 1000).toFixed(1);
  const lead = `${note ? `${note}\n` : ""}The user moved this command to the background after ${seconds} s. It keeps running as background task ${outcome.task_id}, now without a timeout; its status, exit code and output arrive automatically when it ends, and get_background_task reads them earlier.\n`;
  const output = outcome.output.text(result_cap_tokens - estimate_tokens(`${lead}Output so far:\n`));
  return {
    status: "done",
    text: `${lead}${output ? `Output so far:\n${output}` : "No output so far."}`,
    view: background_view({ id: outcome.task_id, command, status: "running", shell }, output),
  };
};
