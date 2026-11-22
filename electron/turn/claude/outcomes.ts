import type { AccountInfo, SDKResultMessage, SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CompactionError } from "../../../shared/chat.ts";
import type { ClaudeRuntime, ClaudeSessionRef } from "../../claude/runtime.ts";
import { ModelError } from "../../model/errors.ts";
import type { ApiMessage } from "../../model/types.ts";
import { error_text } from "../../storage/coerce.ts";
import { compaction_turn_error } from "../compaction.ts";
import { inject_steers, stop_continues, type StopState } from "../loop.ts";
import { round_profile } from "../round.ts";
import type { TurnSession } from "../session.ts";
import { continuation_text } from "../user-input.ts";
import type { CallRegistry } from "./calls.ts";
import type { CompactionTracker } from "./compaction.ts";
import type { TurnEnd } from "./end.ts";
import { is_error_result, key_error, names_missing_session, process_error, provider_error, refusal_error, result_error, result_text } from "./errors.ts";
import type { Feeder, InputChannel } from "./input.ts";
import type { ClaudeTurnInput } from "./drive.ts";
import { silent_tools } from "./names.ts";
import type { Rounds } from "./rounds.ts";
import type { StreamMap } from "./stream-map.ts";

export type TurnShared = {
  runtime: ClaudeRuntime;
  end: TurnEnd;
  progress: { round: () => number };
  stop_state: StopState;
  opening: ApiMessage[] | null;
  base: number;
};

export type Attempt = {
  session: TurnSession;
  input: ClaudeTurnInput;
  shared: TurnShared;
  resume: ClaudeSessionRef | null;
  channel: InputChannel;
  calls: CallRegistry;
  rounds: Rounds;
  feeder: Feeder;
  compaction: CompactionTracker;
  map: StreamMap;
  saved: boolean;
  stale: boolean;
  announced_seen: number;
};

export type ResultOutcome = "missing" | null;

const session_kinds: ReadonlySet<ModelError["kind"]> = new Set(["bad_request", "context_limit", "internal"]);

export const no_session_text = "This chat has no Claude Code session to compact.";

const no_compaction_text = "Claude Code finished /compact without compacting the conversation.";

const fresh_resume = (attempt: Attempt): boolean => attempt.resume !== null && attempt.rounds.completed_count() === 0;

export const fail_turn = async (attempt: Attempt, error: ModelError): Promise<void> => {
  if (fresh_resume(attempt) && session_kinds.has(error.kind)) {
    attempt.stale = true;
  }
  await attempt.shared.end.fail(error);
};

const own_tools = (session: TurnSession, tools: string[]): string[] => {
  const offered = new Set(session.resolve_tools(round_profile(session)).map((tool) => tool.spec.name));
  return tools.filter((name) => !silent_tools.has(name) && !name.startsWith("mcp__") && !offered.has(name));
};

const account_error = async (session: TurnSession, account: () => Promise<AccountInfo>): Promise<ModelError | null> => {
  try {
    const provider = (await account()).apiProvider;
    return provider === undefined || provider === "firstParty" ? null : provider_error(provider);
  } catch (error) {
    console.error(`[claude] reading the account of Claude Code in chat ${session.chat_id} failed:`, error);
    return process_error(`the account it runs on could not be read: ${error_text(error)}`);
  }
};

const first_init_error = async (session: TurnSession, message: SDKSystemMessage, account: () => Promise<AccountInfo>): Promise<ModelError | null> => {
  const own = own_tools(session, message.tools);
  if (own.length) {
    return new ModelError("claude_process", `Claude Code started with its own tools: ${own.join(", ")}`);
  }
  return account_error(session, account);
};

export const on_init = async (attempt: Attempt, message: SDKSystemMessage, account: () => Promise<AccountInfo>): Promise<void> => {
  const { session, input } = attempt;
  const first = !attempt.saved;
  if (first) {
    attempt.saved = true;
    console.info(`[claude] chat ${session.chat_id} runs Claude Code session ${message.session_id} (Claude Code ${message.claude_code_version}) with tools ${message.tools.join(", ")}`);
    try {
      await input.save({ session_id: message.session_id, cwd: session.project_root, through_message_id: input.turn_id });
    } catch (error) {
      console.error(`[claude] saving Claude Code session ${message.session_id} for chat ${session.chat_id} failed:`, error);
    }
  }
  if (message.apiKeySource !== "none") {
    await fail_turn(attempt, key_error(message.apiKeySource));
    return;
  }
  const error = first ? await first_init_error(session, message, account) : null;
  if (error) {
    await fail_turn(attempt, error);
  }
};

const missing_session = (attempt: Attempt, result: SDKResultMessage): boolean =>
  fresh_resume(attempt) && is_error_result(result) && names_missing_session([result_text(result)]);

const reset_stop_state = (attempt: Attempt) => {
  const announced = attempt.calls.announced();
  if (announced !== attempt.announced_seen) {
    attempt.announced_seen = announced;
    attempt.shared.stop_state.active = false;
  }
};

const delivered = async (attempt: Attempt, round: number): Promise<boolean> => {
  if (!(await attempt.feeder.poll(round + 1))) {
    return false;
  }
  attempt.shared.stop_state.active = false;
  return true;
};

export const on_result = async (attempt: Attempt, result: SDKResultMessage): Promise<ResultOutcome> => {
  const { session, shared, rounds, feeder } = attempt;
  const round = Math.max(rounds.number(), 0);
  if (session.signal.aborted) {
    shared.end.finish("stopped");
    return null;
  }
  if (missing_session(attempt, result)) {
    return "missing";
  }
  if (is_error_result(result)) {
    await fail_turn(attempt, result_error(result, attempt.map.facts(), shared.runtime.usage_limit_prefixes));
    return null;
  }
  if (result.stop_reason === "refusal") {
    await fail_turn(attempt, refusal_error());
    return null;
  }
  if (attempt.channel.pending() || (result.queued_turn_count ?? 0) > 0) {
    return null;
  }
  reset_stop_state(attempt);
  if (result.stop_reason === "max_tokens") {
    session.emit({ type: "notice", round, notice: "output_limit", text: "" });
    feeder.push([{ role: "user", content: continuation_text }]);
    return null;
  }
  if (await delivered(attempt, round)) {
    return null;
  }
  while (session.idle && (await session.idle())) {
    if (session.signal.aborted) {
      shared.end.finish("stopped");
      return null;
    }
    if (await delivered(attempt, round)) {
      return null;
    }
  }
  const scratch: ApiMessage[] = [];
  if (await stop_continues(session, round, rounds.last_text(), scratch, shared.stop_state)) {
    feeder.push(scratch);
    return null;
  }
  shared.end.finish(session.signal.aborted ? "stopped" : "done");
  return null;
};

export const on_compact_result = async (attempt: Attempt, result: SDKResultMessage): Promise<ResultOutcome> => {
  const { session, shared, compaction } = attempt;
  if (session.signal.aborted) {
    shared.end.finish("stopped");
    return null;
  }
  if (missing_session(attempt, result)) {
    return "missing";
  }
  if (compaction.seen()) {
    shared.end.finish("done");
    return null;
  }
  const classified = is_error_result(result) ? result_error(result, attempt.map.facts(), shared.runtime.usage_limit_prefixes) : null;
  const error: CompactionError = classified ? { kind: classified.kind, message: classified.message } : { kind: "internal", message: no_compaction_text };
  compaction.failed(error);
  shared.end.finish("failed", compaction_turn_error(error));
  return null;
};

export const on_compacted = (attempt: Attempt): void => {
  if (attempt.input.compact_only && attempt.compaction.settled()) {
    attempt.shared.end.finish(attempt.session.signal.aborted ? "stopped" : "done");
  }
};

export const on_compact_failed = (attempt: Attempt, error: CompactionError): void => {
  if (attempt.input.compact_only) {
    attempt.shared.end.finish("failed", compaction_turn_error(error));
  }
};

export const decide_plan = async (attempt: Attempt, round: number): Promise<void> => {
  const { session, shared, feeder } = attempt;
  if (shared.end.closing()) {
    return;
  }
  shared.stop_state.active = false;
  const scratch: ApiMessage[] = [];
  if (await inject_steers(session, round + 1, scratch)) {
    feeder.push(scratch);
    return;
  }
  if (await stop_continues(session, round, attempt.rounds.last_text(), scratch, shared.stop_state)) {
    feeder.push(scratch);
    return;
  }
  shared.end.finish(session.signal.aborted ? "stopped" : "done");
};
