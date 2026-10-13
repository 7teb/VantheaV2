import type { CompactionError, CompactionSource, ContextCalibration, TurnError } from "../../shared/chat.ts";
import { calibration_scale, measure_request } from "../context/calibration.ts";
import { compacted_messages } from "../context/compact.ts";
import { compaction_request, removed_output_line } from "../context/compact-text.ts";
import { estimate_tokens } from "../context/estimate.ts";
import { drop_oldest_outputs, fit_window, type RemovedOutput } from "../context/window.ts";
import { compaction_effort } from "../model/catalog.ts";
import { ModelError } from "../model/errors.ts";
import { abortable_sleep } from "../model/transport.ts";
import type { ApiMessage, ApiUserMessage, RoundCallbacks, RoundRequest } from "../model/types.ts";
import { error_text } from "../storage/coerce.ts";
import type { ToolSpec } from "../tools/types.ts";
import { fit_request, round_profile } from "./round.ts";
import type { TurnSession } from "./session.ts";

export type CompactOutcome = { status: "done"; tokens: number } | { status: "failed"; error: CompactionError } | { status: "stopped" };

type NoteOutcome = { status: "written"; note: string } | { status: "failed"; error: CompactionError } | { status: "stopped" };

type NoteRequest = { messages: ApiMessage[]; ask: ApiUserMessage; removed: RemovedOutput[] };

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

const note_request = (session: TurnSession, api_messages: ApiMessage[], tools: ToolSpec[], calibration: ContextCalibration | null): NoteRequest => {
  const ask: ApiUserMessage = { role: "user", steer: true, content: compaction_request(session.compaction.audience) };
  const note: NoteRequest = { messages: [...api_messages.map(request_copy), ask], ask, removed: [] };
  const scale = calibration_scale(calibration);
  const fit = () => fit_window(note.messages, session.model, measure_request(note.messages, tools, session.model, calibration), listed_tokens, note_room_fill, scale);
  for (let removed = fit(); removed.length; removed = fit()) {
    list_removed(session, note, removed);
  }
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

const write_note = async (session: TurnSession, messages: ApiMessage[], tools: ToolSpec[]): Promise<string> => {
  const request: RoundRequest = {
    model: session.model,
    effort: compaction_effort(session.model, session.effort),
    messages,
    tools,
    tool_choice: "none",
  };
  await fit_request(request);
  const callbacks: RoundCallbacks = {
    on_text: ignore,
    on_reasoning: ignore,
    on_tool_draft: ignore,
    on_retry: ignore,
  };
  const result = await session.stream(request, callbacks, session.signal, { max_attempts: 1 });
  return result.status === "completed" ? result.content.trim() : "";
};

const attempt_note = async (session: TurnSession, messages: ApiMessage[], tools: ToolSpec[]): Promise<NoteOutcome> => {
  try {
    const note = await write_note(session, messages, tools);
    if (session.signal.aborted) {
      return { status: "stopped" };
    }
    return note ? { status: "written", note } : { status: "failed", error: { kind: "empty_note", message: `${session.model.id} returned an empty compaction note` } };
  } catch (error) {
    if (session.signal.aborted) {
      return { status: "stopped" };
    }
    return { status: "failed", error: failure_of(error) };
  }
};

const attempt_fitting_note = async (session: TurnSession, round: number, note: NoteRequest, tools: ToolSpec[]): Promise<NoteOutcome> => {
  for (;;) {
    const outcome = await attempt_note(session, note.messages, tools);
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

const note_with_retries = async (session: TurnSession, round: number, source: CompactionSource, note: NoteRequest, tools: ToolSpec[]): Promise<NoteOutcome> => {
  const sleep = session.compaction.sleep ?? abortable_sleep;
  for (let attempt = 1; ; attempt += 1) {
    session.emit({ type: "compaction", round, status: "running", source, attempt, attempts: compaction_attempts });
    const outcome = await attempt_fitting_note(session, round, note, tools);
    if (outcome.status !== "failed") {
      return outcome;
    }
    const { kind, message } = outcome.error;
    console.error(`[turn] compaction attempt ${attempt} of ${compaction_attempts} in round ${round} of ${turn_scope(session)} failed (${kind}): ${message}`);
    if (kind === "context_limit" || attempt === compaction_attempts) {
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
    const written = await note_with_retries(session, round, source, note_request(session, api_messages, tools, calibration), tools);
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
