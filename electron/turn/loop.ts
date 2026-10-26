import type { ContextCalibration, TurnError } from "../../shared/chat.ts";
import type { FinalStatus } from "../../shared/events.ts";
import { calibrate, calibration_scale, context_parts, context_usage, measure_request } from "../context/calibration.ts";
import { compact_threshold, compaction_due, compaction_floor } from "../context/compact.ts";
import { trim_tool_messages } from "../context/trim.ts";
import { fit_window } from "../context/window.ts";
import { error_text } from "../storage/coerce.ts";
import { ModelError } from "../model/errors.ts";
import type { ApiMessage } from "../model/types.ts";
import type { ToolSpec } from "../tools/types.ts";
import { compact_context, compaction_turn_error } from "./compaction.ts";
import { round_profile, run_round } from "./round.ts";
import type { TurnNote, TurnSession } from "./session.ts";
import { steer_message } from "./user-input.ts";

const continuation_text = "Your last message hit the model's maximum output length and was cut off. Continue exactly where you left off and keep going until the task is finished. Do not start over or repeat what you already wrote.";

const output_limit_note = "The previous response reached the model's maximum output length and was continued.";

const window_note = "The conversation did not fit into the model's context window, so the oldest tool outputs were removed from this request.";

const compaction_fallback_note = "Compacting the context failed, so older tool output in this turn was dropped instead.";

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

const round_specs = (session: TurnSession): ToolSpec[] => session.resolve_tools(round_profile(session)).map((tool) => tool.spec);

const measure = (session: TurnSession, messages: ApiMessage[], calibration: ContextCalibration | null): number =>
  measure_request(messages, round_specs(session), session.model, calibration);

const report_context = (session: TurnSession, messages: ApiMessage[], used: number, calibration: ContextCalibration | null, floor: number) =>
  session.emit({ type: "context", usage: context_usage(used, session.model, calibration, floor, context_parts(messages, round_specs(session), session.model, used)) });

const inject_steers = async (session: TurnSession, round: number, api_messages: ApiMessage[]): Promise<boolean> => {
  const source = session.steers;
  if (!source) {
    return false;
  }
  let taken = false;
  for (let steer = source.next(); steer; steer = source.next()) {
    const attachments = await source.noted(steer);
    if (session.signal.aborted) {
      return taken;
    }
    source.take(steer.id);
    session.emit({
      type: "steer",
      round,
      text: steer.text,
      pushed_at: steer.at,
      steer_id: steer.id,
      ...(attachments.length ? { attachments } : {}),
      ...(steer.assistant_reference ? { assistant_reference: steer.assistant_reference } : {}),
    });
    api_messages.push(await steer_message(steer.text, attachments, session.model));
    taken = true;
  }
  return taken;
};

export const push_notes = (emit: TurnSession["emit"], notes: TurnNote[], round: number, api_messages: ApiMessage[]): void => {
  for (const note of notes) {
    emit(note.kind === "steer" ? { type: "steer", round, text: note.text } : { type: "notice", round, notice: note.notice, text: note.text });
    api_messages.push({ role: "user", content: note.content, ...(note.kind === "steer" ? { instruction: true as const } : {}) });
  }
};

const deliver_input = async (session: TurnSession, round: number, api_messages: ApiMessage[]) => {
  await inject_steers(session, round, api_messages);
  push_notes(session.emit, session.take_notes?.() ?? [], round, api_messages);
};

const drop_old_results = (session: TurnSession, round: number, api_messages: ApiMessage[], calibration: ContextCalibration | null) => {
  if (trim_tool_messages(api_messages, session.model, compact_threshold(session.model), calibration_scale(calibration))) {
    session.emit({ type: "notice", round, notice: "context_trimmed", text: compaction_fallback_note });
  }
};

export const run_turn_loop = async (session: TurnSession, api_messages: ApiMessage[]): Promise<void> => {
  let calibration = session.stored_context?.calibration ?? null;
  let floor = session.stored_context?.floor ?? 0;
  let carried_floor = floor;
  try {
    for (let round = 0; ; round += 1) {
      if (session.signal.aborted) {
        session.emit({ type: "end", status: "stopped", error: null });
        return;
      }
      await deliver_input(session, round, api_messages);
      const tokens = measure(session, api_messages, calibration);
      report_context(session, api_messages, tokens, calibration, carried_floor);
      if (compaction_due(tokens, floor, session.model)) {
        const compaction = await compact_context(session, round, api_messages, "auto", calibration);
        if (compaction.status === "stopped") {
          session.emit({ type: "end", status: "stopped", error: null });
          return;
        }
        if (compaction.status === "failed") {
          drop_old_results(session, round, api_messages, calibration);
        }
        floor = compaction_floor(compaction.status === "done" ? compaction.tokens : tokens, session.model);
        carried_floor = compaction.status === "done" ? floor : 0;
        report_context(session, api_messages, measure(session, api_messages, calibration), calibration, carried_floor);
        await deliver_input(session, round, api_messages);
      }
      if (fit_window(api_messages, session.model, measure(session, api_messages, calibration), undefined, 1, calibration_scale(calibration)).length) {
        session.emit({ type: "notice", round, notice: "context_trimmed", text: window_note });
      }
      const outcome = await run_round(session, round, api_messages, calibration);
      const next = calibrate(outcome.usage, outcome.estimate) ?? calibration;
      const rescale = calibration_scale(next) / calibration_scale(calibration);
      floor = Math.ceil(floor * rescale);
      carried_floor = Math.ceil(carried_floor * rescale);
      calibration = next;
      report_context(session, api_messages, measure(session, api_messages, calibration), calibration, carried_floor);
      if (outcome.aborted) {
        session.emit({ type: "end", status: "stopped", error: null });
        return;
      }
      if (outcome.plan_presented) {
        if (await inject_steers(session, round + 1, api_messages)) {
          continue;
        }
        session.emit({ type: "end", status: session.signal.aborted ? "stopped" : "done", error: null });
        return;
      }
      if (outcome.tool_calls === 0) {
        if (outcome.finish_reason === "length") {
          session.emit({ type: "notice", round, notice: "output_limit", text: output_limit_note });
          api_messages.push({ role: "user", content: continuation_text });
          continue;
        }
        if (await inject_steers(session, round + 1, api_messages)) {
          continue;
        }
        if (session.idle && (await session.idle())) {
          continue;
        }
        session.emit({ type: "end", status: session.signal.aborted ? "stopped" : "done", error: null });
        return;
      }
    }
  } catch (error) {
    if (session.signal.aborted) {
      session.emit({ type: "end", status: "stopped", error: null });
      return;
    }
    session.emit({ type: "end", status: end_status(error), error: end_error(error) });
  }
};

export const run_compaction_turn = async (session: TurnSession, api_messages: ApiMessage[]): Promise<void> => {
  const calibration = session.stored_context?.calibration ?? null;
  const outcome = await compact_context(session, 0, api_messages, "manual", calibration);
  if (outcome.status === "failed") {
    session.emit({ type: "end", status: "failed", error: compaction_turn_error(outcome.error) });
    return;
  }
  if (outcome.status === "done") {
    report_context(session, api_messages, outcome.tokens, calibration, compaction_floor(outcome.tokens, session.model));
  }
  session.emit({ type: "end", status: outcome.status === "done" ? "done" : "stopped", error: null });
};
