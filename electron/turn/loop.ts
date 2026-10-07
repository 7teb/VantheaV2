import type { TurnError } from "../../shared/chat.ts";
import type { FinalStatus } from "../../shared/events.ts";
import { usage_from_round } from "../context/estimate.ts";
import { trim_tool_messages } from "../context/trim.ts";
import { estimate_messages } from "../context/usage.ts";
import { error_text } from "../storage/coerce.ts";
import { ModelError } from "../model/errors.ts";
import type { ApiMessage } from "../model/types.ts";
import { user_content } from "./history.ts";
import { run_round } from "./round.ts";
import type { TurnSession } from "./session.ts";

export const max_rounds = 200;

const steer_prefix =
  "[The user sent this while you were working on this turn. Reply to it in your next visible output before your next tool call, in one or two sentences, then keep working. It does not end the turn.]";

const continuation_text = "Your last message hit the model's maximum output length and was cut off. Continue exactly where you left off and keep going until the task is finished. Do not start over or repeat what you already wrote.";

const output_limit_note = "The previous response reached the model's maximum output length and was continued.";

const context_trimmed_note = "Older tool output in this turn was shortened to stay inside the context window.";

const wrap_up_texts = {
  context: "[The context window is nearly full, so tools are no longer available. Write your complete final answer now from the work already done.]",
  rounds: "[This is the last round this run may use, so tools are no longer available. Write your complete final answer now from the work already done.]",
};

const wrap_up_note = "The context window is nearly full, so tools were removed and the final answer was requested.";

const interrupted_kinds = new Set<TurnError["kind"]>(["stream_interrupted", "timeout", "provider_unavailable"]);

const end_status = (error: unknown): FinalStatus => {
  if (error instanceof ModelError) {
    if (error.kind === "policy") {
      return "blocked";
    }
    return interrupted_kinds.has(error.kind) ? "interrupted" : "failed";
  }
  return "failed";
};

const end_error = (error: unknown): TurnError =>
  error instanceof ModelError ? { kind: error.kind, message: error.message } : { kind: "internal", message: error_text(error) };

const wrap_up_reason = (session: TurnSession, round: number, rounds: number, api_messages: ApiMessage[]): keyof typeof wrap_up_texts | null => {
  if (session.wrap_up_at === undefined) {
    return null;
  }
  if (round === rounds - 1) {
    return "rounds";
  }
  return estimate_messages(api_messages) > session.model.context_length * session.wrap_up_at ? "context" : null;
};

const inject_steers = async (session: TurnSession, round: number, api_messages: ApiMessage[]): Promise<boolean> => {
  const steers = session.take_steers();
  for (const { id, text, attachments } of steers) {
    session.emit({ type: "steer", round, text, steer_id: id, ...(attachments.length ? { attachments } : {}) });
    api_messages.push({ role: "user", content: await user_content(`${steer_prefix}\n\n${text}`, attachments, session.model) });
  }
  return steers.length > 0;
};

export const run_turn_loop = async (session: TurnSession, api_messages: ApiMessage[]): Promise<void> => {
  const rounds = session.max_rounds ?? max_rounds;
  let wrapping = false;
  try {
    for (let round = 0; round < rounds; round += 1) {
      if (session.signal.aborted) {
        session.emit({ type: "end", status: "stopped", error: null });
        return;
      }
      await inject_steers(session, round, api_messages);
      for (const note of session.take_notes?.() ?? []) {
        session.emit(note.kind === "steer" ? { type: "steer", round, text: note.text } : { type: "notice", round, notice: note.notice, text: note.text });
        api_messages.push({ role: "user", content: note.content });
      }
      if (trim_tool_messages(api_messages, session.model)) {
        session.emit({ type: "notice", round, notice: "context_trimmed", text: context_trimmed_note });
      }
      const reason = wrapping ? null : wrap_up_reason(session, round, rounds, api_messages);
      if (reason) {
        wrapping = true;
        if (reason === "context") {
          session.emit({ type: "notice", round, notice: "context_trimmed", text: wrap_up_note });
        }
        api_messages.push({ role: "user", content: wrap_up_texts[reason] });
      }
      const outcome = await run_round(session, round, api_messages, !wrapping);
      if (outcome.usage) {
        session.emit({ type: "context", usage: usage_from_round(outcome.usage, session.model) });
      }
      if (outcome.aborted) {
        session.emit({ type: "end", status: "stopped", error: null });
        return;
      }
      const last_round = round === rounds - 1;
      if (outcome.plan_presented) {
        if (!last_round && (await inject_steers(session, round + 1, api_messages))) {
          continue;
        }
        session.emit({ type: "end", status: "done", error: null });
        return;
      }
      if (outcome.tool_calls === 0) {
        if (outcome.finish_reason === "length" && !last_round) {
          session.emit({ type: "notice", round, notice: "output_limit", text: output_limit_note });
          api_messages.push({ role: "user", content: continuation_text });
          continue;
        }
        if (!last_round && (await inject_steers(session, round + 1, api_messages))) {
          continue;
        }
        if (session.idle && (await session.idle())) {
          continue;
        }
        session.emit({ type: "end", status: session.signal.aborted ? "stopped" : "done", error: null });
        return;
      }
    }
    session.emit({ type: "end", status: "done", error: null });
  } catch (error) {
    session.emit({ type: "end", status: end_status(error), error: end_error(error) });
  }
};
