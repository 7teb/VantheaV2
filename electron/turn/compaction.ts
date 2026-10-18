import type { CompactionError, CompactionSource, ContextCalibration, TurnError } from "../../shared/chat.ts";
import { calibration_scale, measure_request, output_budget } from "../context/calibration.ts";
import { compacted_messages } from "../context/compact.ts";
import { compaction_request, removed_output_line } from "../context/compact-text.ts";
import { estimate_tokens } from "../context/estimate.ts";
import { drop_oldest_outputs, fit_window, type RemovedOutput } from "../context/window.ts";
import { is_retryable, ModelError } from "../model/errors.ts";
import { abortable_sleep } from "../model/transport.ts";
import type { ApiMessage, ApiUserMessage, RoundCallbacks, RoundRequest } from "../model/types.ts";
import { error_text } from "../storage/coerce.ts";
import type { ToolSpec } from "../tools/types.ts";
import { fit_request, round_profile } from "./round.ts";
import type { TurnSession } from "./session.ts";

export type CompactOutcome = { status: "done"; tokens: number } | { status: "failed"; error: CompactionError } | { status: "stopped" };

type NoteOutcome = { status: "written"; note: string } | { status: "failed"; error: CompactionError; retry: boolean } | { status: "stopped" };

type NoteRequest = { messages: ApiMessage[]; ask: ApiUserMessage; removed: RemovedOutput[]; tool_choice?: "none"; cut: boolean };

type NoteReply = { text: string; finish_reason: string; called_tools: boolean; room_bound: boolean };

const quick_waits_ms = [2000, 5000, 10_000];

const slow_wait_ms = 60_000;

const slow_tries = 10;

const compaction_attempts = 1 + quick_waits_ms.length + slow_tries;

const note_room_fill = 0.9;

const ignore = () => undefined;

const turn_scope = (session: TurnSession) => `turn ${session.call_scope ?? session.message_id} in chat ${session.chat_id}`;

export const compaction_turn_error = (error: CompactionError): TurnError => ({ kind: error.kind === "empty_note" ? "internal" : error.kind, message: error.message });

const failure_of = (error: unknown): CompactionError =>
  error instanceof ModelError ? { kind: error.kind, message: error.message } : { kind: "internal", message: error_text(error) };

const listed_tokens = (output: RemovedOutput) => estimate_tokens(removed_output_line(output));

const request_copy = (message: ApiMessage): ApiMessage => (message.role === "user" && Array.isArray(message.content) ? { ...message, content: [...message.content] } : { ...message });

const list_removed = (session: TurnSession, note: NoteRequest, removed: RemovedOutput[]) => {
  note.removed.push(...removed);
  note.ask.content = compaction_request(session.compaction.audience, note.removed);
};

const fit_note = (session: TurnSession, note: NoteRequest, tools: ToolSpec[], calibration: ContextCalibration | null, fill: number): number => {
  const before = note.removed.length;
  const scale = calibration_scale(calibration);
  const fit = () => fit_window(note.messages, session.model, measure_request(note.messages, tools, session.model, calibration), listed_tokens, fill, scale);
  for (let removed = fit(); removed.length; removed = fit()) {
    list_removed(session, note, removed);
  }
  return note.removed.length - before;
};

const note_request = (session: TurnSession, api_messages: ApiMessage[], tools: ToolSpec[], calibration: ContextCalibration | null): NoteRequest => {
  const ask: ApiUserMessage = { role: "user", steer: true, content: compaction_request(session.compaction.audience) };
  const note: NoteRequest = { messages: [...api_messages.map(request_copy), ask], ask, removed: [], cut: false };
  fit_note(session, note, tools, calibration, 1);
  return note;
};

const drop_next_output = (session: TurnSession, note: NoteRequest): RemovedOutput | null => {
  const [removed] = drop_oldest_outputs(note.messages, session.model, 1, listed_tokens);
  if (!removed) {
    return null;
  }
  list_removed(session, note, [removed]);
  return removed;
};

const write_note = async (session: TurnSession, note: NoteRequest, tools: ToolSpec[], calibration: ContextCalibration | null): Promise<NoteReply> => {
  const request: RoundRequest = {
    model: session.model,
    effort: session.effort,
    messages: note.messages,
    tools,
    ...(note.tool_choice ? { tool_choice: note.tool_choice } : {}),
  };
  await fit_request(request);
  request.max_tokens = output_budget(request.messages, request.tools, session.model, calibration);
  const room_bound = request.max_tokens === undefined || request.max_tokens < session.model.max_output;
  const callbacks: RoundCallbacks = {
    on_text: ignore,
    on_reasoning: ignore,
    on_tool_draft: ignore,
    on_retry: ignore,
  };
  const result = await session.stream(request, callbacks, session.signal, { max_attempts: 1 });
  if (result.status !== "completed") {
    return { text: "", finish_reason: result.finish_reason, called_tools: false, room_bound };
  }
  return { text: result.content.trim(), finish_reason: result.finish_reason, called_tools: result.tool_calls.length > 0, room_bound };
};

const attempt_note = async (session: TurnSession, round: number, note: NoteRequest, tools: ToolSpec[], calibration: ContextCalibration | null): Promise<NoteOutcome> => {
  try {
    for (;;) {
      const reply = await write_note(session, note, tools, calibration);
      if (session.signal.aborted) {
        return { status: "stopped" };
      }
      if (reply.called_tools && !note.tool_choice) {
        console.warn(`[turn] compaction request in round ${round} of ${turn_scope(session)} came back with a tool call instead of the note, sending it again with tools off`);
        note.tool_choice = "none";
        continue;
      }
      if (reply.finish_reason === "length" && reply.room_bound && !note.cut) {
        note.cut = true;
        const removed = fit_note(session, note, tools, calibration, note_room_fill);
        if (removed > 0) {
          console.warn(`[turn] compaction note in round ${round} of ${turn_scope(session)} ran out of room, sending it again without the ${removed} oldest tool outputs to leave a tenth of the window for the note`);
          continue;
        }
      }
      return reply.text ? { status: "written", note: reply.text } : { status: "failed", error: { kind: "empty_note", message: `${session.model.id} returned an empty compaction note` }, retry: true };
    }
  } catch (error) {
    if (session.signal.aborted) {
      return { status: "stopped" };
    }
    return { status: "failed", error: failure_of(error), retry: !(error instanceof ModelError) || is_retryable(error) };
  }
};

const attempt_fitting_note = async (session: TurnSession, round: number, note: NoteRequest, tools: ToolSpec[], calibration: ContextCalibration | null): Promise<NoteOutcome> => {
  for (;;) {
    const outcome = await attempt_note(session, round, note, tools, calibration);
    if (outcome.status !== "failed" || outcome.error.kind !== "context_limit") {
      return outcome;
    }
    const removed = drop_next_output(session, note);
    if (!removed) {
      return outcome;
    }
    console.warn(`[turn] compaction request in round ${round} of ${turn_scope(session)} exceeded the context window (${outcome.error.message}), sending it again without the output of ${removed.tool} (${removed.call_id})`);
  }
};

const note_with_retries = async (session: TurnSession, round: number, source: CompactionSource, note: NoteRequest, tools: ToolSpec[], calibration: ContextCalibration | null): Promise<NoteOutcome> => {
  const sleep = session.compaction.sleep ?? abortable_sleep;
  for (let attempt = 1; ; attempt += 1) {
    session.emit({ type: "compaction", round, status: "running", source, attempt, attempts: compaction_attempts });
    const outcome = await attempt_fitting_note(session, round, note, tools, calibration);
    if (outcome.status !== "failed") {
      return outcome;
    }
    const { kind, message } = outcome.error;
    console.error(`[turn] compaction attempt ${attempt} of ${compaction_attempts} in round ${round} of ${turn_scope(session)} failed (${kind}): ${message}`);
    if (!outcome.retry || attempt === compaction_attempts) {
      return outcome;
    }
    const wait_ms = quick_waits_ms[attempt - 1] ?? slow_wait_ms;
    session.emit({ type: "compaction", round, status: "waiting", source, attempt, attempts: compaction_attempts, error: outcome.error, wait_ms });
    await sleep(wait_ms, session.signal);
    if (session.signal.aborted) {
      return { status: "stopped" };
    }
  }
};

export const compact_context = async (
  session: TurnSession,
  round: number,
  api_messages: ApiMessage[],
  source: CompactionSource,
  calibration: ContextCalibration | null,
): Promise<CompactOutcome> => {
  try {
    const tools = session.resolve_tools(round_profile(session)).map((tool) => tool.spec);
    const written = await note_with_retries(session, round, source, note_request(session, api_messages, tools, calibration), tools, calibration);
    if (written.status === "stopped") {
      return written;
    }
    if (written.status === "failed") {
      session.emit({ type: "compaction", round, status: "failed", source, error: written.error });
      return written;
    }
    const facts = await session.compaction.facts();
    const compacted = compacted_messages({ note: written.note, facts, audience: session.compaction.audience, history: api_messages.slice(1), model: session.model });
    await session.compaction.save?.({ note: written.note, facts, through_round: round - 1 });
    api_messages.splice(1, api_messages.length - 1, ...compacted);
    session.emit({ type: "compaction", round, status: "done", source });
    return { status: "done", tokens: measure_request(api_messages, tools, session.model, calibration) };
  } catch (error) {
    if (session.signal.aborted) {
      return { status: "stopped" };
    }
    console.error(`[turn] compacting round ${round} of ${turn_scope(session)} failed:`, error);
    const failure = failure_of(error);
    session.emit({ type: "compaction", round, status: "failed", source, error: failure });
    return { status: "failed", error: failure };
  }
};
