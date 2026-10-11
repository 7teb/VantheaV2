import type { ToolContext } from "../tools/types.ts";
import { last_human_id } from "./context.ts";
import { decide_command, type CommandDecision } from "./decide.ts";
import { command_input } from "./review.ts";
import { command_sleep_reason, rejected_text } from "./sleep.ts";
import { changed_pins, type PinChange } from "./source-read.ts";
import { scripts_changed_text } from "./verdict-text.ts";

export type CommandSpec = { command: string; cwd: string; background: boolean };

export type Settled = { kind: "run"; note: string | null } | { kind: "block"; reason: string } | { kind: "denied"; text: string; output: string };

const max_reviews = 3;

export const peer_block_since = async(ctx: ToolContext, seen: ReadonlySet<string>): Promise<boolean> => {
  const { records } = await ctx.review.history();
  return records.some((record) => !seen.has(record.id) && record.actor.id !== ctx.review.actor.id && record.verdict !== "allow");
};

export const under_review = async <T>(ctx: Pick<ToolContext, "progress">, run: (enter: () => void) => Promise<T>): Promise<T> => {
  let entered = false;
  const enter = () => {
    if (entered) {
      return;
    }
    entered = true;
    ctx.progress({ label: "", lines: null, output_tail: null, phase: "review" });
  };
  try {
    return await run(enter);
  } finally {
    if (entered) {
      ctx.progress({ label: "", lines: null, output_tail: null });
    }
  }
};

export const command_pass = async (ctx: ToolContext, spec: CommandSpec, changed: PinChange[]): Promise<CommandDecision> => {
  const input = await command_input(ctx, spec.command, spec.cwd, spec.background, changed);
  return under_review(ctx, async (enter) => {
    let decision = await decide_command(input, ctx.review, ctx.signal, enter);
    const model_allow = decision.action === "run" && decision.record?.source === "model";
    if (model_allow && (last_human_id(ctx.chat_id) !== input.last_human_id || (await peer_block_since(ctx, decision.seen)))) {
      decision = await decide_command(await command_input(ctx, spec.command, spec.cwd, spec.background, changed), ctx.review, ctx.signal, enter);
    }
    if (decision.record) {
      await ctx.review.record(decision.record);
    }
    return decision;
  });
};

export const reviewed_until_stable = async (
  ctx: ToolContext,
  spec: CommandSpec,
  settle: (decision: CommandDecision, rechecked: boolean) => Promise<Settled>,
): Promise<Settled> => {
  ctx.signal.throwIfAborted();
  const sleep = command_sleep_reason(ctx, spec.command);
  if (sleep) {
    const text = rejected_text(sleep);
    return { kind: "denied", text, output: text };
  }
  let changed: PinChange[] = [];
  for (let pass = 1; ; pass += 1) {
    const decision = await command_pass(ctx, spec, changed);
    const outcome = await settle(decision, changed.length > 0);
    if (outcome.kind !== "run") {
      return outcome;
    }
    const now = await changed_pins(decision.pins);
    ctx.signal.throwIfAborted();
    if (!now.length) {
      return outcome;
    }
    if (decision.record) {
      await ctx.review.record({ ...decision.record, superseded: "scripts_changed" });
    }
    if (pass >= max_reviews) {
      const text = scripts_changed_text(now.map((change) => change.path));
      return { kind: "denied", text, output: text };
    }
    changed = now;
  }
};
