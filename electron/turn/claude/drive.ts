import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { claude_runtime, type ClaudeQuery, type ClaudeRuntime, type ClaudeSessionRef } from "../../claude/runtime.ts";
import type { ApiMessage } from "../../model/types.ts";
import { error_text } from "../../storage/coerce.ts";
import { deliver_input, push_notes } from "../loop.ts";
import type { TurnSession } from "../session.ts";
import { create_bridge } from "./bridge.ts";
import { create_call_registry } from "./calls.ts";
import { create_compaction_tracker, post_compact_hook } from "./compaction.ts";
import { message_blocks, type UserBlock } from "./content.ts";
import { create_turn_end } from "./end.ts";
import { limit_error, names_missing_session, process_error } from "./errors.ts";
import { create_gate } from "./gate.ts";
import { carried_history } from "./handoff.ts";
import { create_feeder, create_input_channel } from "./input.ts";
import { claude_effort, claude_options, compact_window, managed_mcp_path } from "./options.ts";
import { decide_plan, fail_turn, no_session_text, on_compact_failed, on_compact_result, on_compacted, on_init, on_result, type Attempt, type ResultOutcome, type TurnShared } from "./outcomes.ts";
import { create_rounds } from "./rounds.ts";
import { claude_session_resumable } from "./sessions.ts";
import { create_stream_map, type MapAction } from "./stream-map.ts";

export type ClaudeTurnInput = {
  api_messages: ApiMessage[];
  fresh_count: number;
  compact_only: boolean;
  title: string;
  turn_id: string;
  previous_turn_id: string | null;
  stored: ClaudeSessionRef | null;
  save: (ref: ClaudeSessionRef | null) => Promise<void>;
};

type AttemptOutcome = "ended" | "missing" | "stale";

const compact_command = "/compact";

const system_prompt = (messages: ApiMessage[]): string => {
  const first = messages[0];
  return first?.role === "system" ? first.content : "";
};

const drop_session = async (runtime: ClaudeRuntime, session: TurnSession, input: ClaudeTurnInput, ref: ClaudeSessionRef): Promise<void> => {
  try {
    await runtime.delete_session(ref.session_id, ref.cwd);
  } catch (error) {
    console.error(`[claude] deleting Claude Code session ${ref.session_id} of chat ${session.chat_id} failed:`, error);
  }
  try {
    await input.save(null);
  } catch (error) {
    console.error(`[claude] clearing the Claude Code session of chat ${session.chat_id} failed:`, error);
  }
};

const opening_messages = async (session: TurnSession, input: ClaudeTurnInput, shared: TurnShared): Promise<ApiMessage[]> => {
  if (shared.opening) {
    return shared.opening;
  }
  const scratch: ApiMessage[] = [];
  push_notes(session.emit, (await session.hooks?.start?.()) ?? [], 0, scratch);
  await deliver_input(session, 0, scratch);
  input.api_messages.push(...scratch);
  shared.opening = scratch;
  return scratch;
};

const first_blocks = async (session: TurnSession, input: ClaudeTurnInput, shared: TurnShared, resume: ClaudeSessionRef | null): Promise<UserBlock[]> => {
  const opening = await opening_messages(session, input, shared);
  const fresh_start = shared.base - input.fresh_count;
  const handoff = resume ? null : carried_history(session, input.api_messages, fresh_start);
  return [
    ...(handoff ? [{ type: "text" as const, text: handoff }] : []),
    ...input.api_messages.slice(fresh_start, shared.base).flatMap(message_blocks),
    ...opening.flatMap(message_blocks),
  ];
};

const act = async (attempt: Attempt, action: MapAction, query: ClaudeQuery): Promise<ResultOutcome> => {
  if (action.kind === "init") {
    await on_init(attempt, action.message, query.account);
  } else if (action.kind === "limit") {
    await fail_turn(attempt, limit_error("", action.info));
  } else if (action.kind === "compacted") {
    on_compacted(attempt);
  } else if (action.kind === "compact_failed") {
    on_compact_failed(attempt, action.error);
  } else if (action.kind === "result") {
    return attempt.input.compact_only ? on_compact_result(attempt, action.result) : on_result(attempt, action.result);
  }
  return null;
};

const process_failure = async (attempt: Attempt, query: ClaudeQuery | null, error: unknown): Promise<AttemptOutcome> => {
  const { session, shared } = attempt;
  const detail = error === null ? "the process ended without a result" : error_text(error);
  const stderr = query?.stderr_tail() ?? "";
  if (shared.end.closing()) {
    if (error !== null && !session.signal.aborted) {
      console.warn(`[claude] Claude Code of chat ${session.chat_id} reported an error after its turn ended: ${detail}`);
    }
    return "ended";
  }
  if (session.signal.aborted) {
    shared.end.finish("stopped");
    return "ended";
  }
  if (attempt.resume && attempt.rounds.completed_count() === 0 && names_missing_session([detail, stderr])) {
    return "missing";
  }
  console.error(`[claude] Claude Code of chat ${session.chat_id} failed: ${detail}${stderr ? `\nstderr: ${stderr}` : ""}`);
  await fail_turn(attempt, process_error(detail));
  return "ended";
};

const consume = async (attempt: Attempt, query: ClaudeQuery, hold: () => Promise<void> | null): Promise<AttemptOutcome> => {
  const iterator = query[Symbol.asyncIterator]();
  for (;;) {
    let next: IteratorResult<SDKMessage>;
    try {
      next = await iterator.next();
    } catch (error) {
      return process_failure(attempt, query, error);
    }
    if (next.done) {
      return process_failure(attempt, query, null);
    }
    await hold();
    if (attempt.shared.end.closing()) {
      return "ended";
    }
    if ((await act(attempt, attempt.map.feed(next.value), query)) === "missing") {
      return "missing";
    }
    if (attempt.shared.end.closing()) {
      return "ended";
    }
  }
};

const run_attempt = async (session: TurnSession, input: ClaudeTurnInput, shared: TurnShared, resume: ClaudeSessionRef | null): Promise<AttemptOutcome> => {
  const { runtime, end } = shared;
  const channel = create_input_channel();
  const calls = create_call_registry(session.emit, session.signal);
  const rounds = create_rounds(session, input.api_messages, calls);
  const feeder = create_feeder(session, channel, rounds, end.closing);
  const compaction = create_compaction_tracker(session, input.compact_only ? "manual" : "auto", rounds.number);
  const attempt: Attempt = { session, input, shared, resume, channel, calls, rounds, feeder, compaction, map: create_stream_map({ session, rounds, calls, input: channel, compaction }), saved: false, stale: false, announced_seen: 0 };
  shared.progress.round = rounds.number;
  let query: ClaudeQuery | null = null;
  let hold: Promise<void> | null = null;
  let closed = false;
  const ended = new AbortController();
  const plan = (round: number): Promise<void> => {
    let release: () => void = () => undefined;
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    return feeder.serial(() => decide_plan(attempt, round)).finally(() => {
      hold = null;
      release();
    });
  };
  const bridge = create_bridge({
    session,
    ended: ended.signal,
    calls,
    gate: create_gate(),
    closing: end.closing,
    context: () => ({ used: rounds.used(), limit: session.model.context_length, compact_at: compact_window(session.model) }),
    after_call: async (entry, presented) => {
      await (presented ? plan(entry.round) : feeder.poll(entry.round + 1));
    },
    fail: (error) => {
      void end.fail(error);
    },
  });
  const shutdown = () => {
    if (closed) {
      return;
    }
    closed = true;
    ended.abort(new Error("the Claude Code turn ended"));
    channel.end();
    calls.release();
    query?.close();
  };
  const stop = () => {
    query?.interrupt().catch((error: unknown) => {
      if (!closed) {
        console.warn(`[claude] interrupting Claude Code of chat ${session.chat_id} failed: ${error_text(error)}`);
      }
    });
    queueMicrotask(() => end.finish("stopped"));
  };
  const unwatch = end.watch(shutdown);
  session.signal.addEventListener("abort", stop, { once: true });
  try {
    if (session.signal.aborted) {
      end.finish("stopped");
      return "ended";
    }
    const options = claude_options({
      session,
      system: system_prompt(input.api_messages),
      effort: claude_effort(session),
      resume,
      session_id: randomUUID(),
      title: input.title,
      server: bridge.server,
      permit: bridge.permit,
      post_compact: post_compact_hook(session, rounds.number, () => {
        compaction.summarised();
        on_compacted(attempt);
      }),
      managed_mcp: existsSync(managed_mcp_path),
    });
    try {
      query = runtime.open({ prompt: channel.prompt, options });
    } catch (error) {
      return await process_failure(attempt, null, error);
    }
    if (input.compact_only) {
      channel.command(compact_command);
    } else {
      channel.send(await first_blocks(session, input, shared, resume), true);
    }
    const outcome = await consume(attempt, query, () => hold);
    return outcome === "ended" && attempt.stale ? "stale" : outcome;
  } catch (error) {
    if (session.signal.aborted) {
      end.finish("stopped");
      return "ended";
    }
    console.error(`[claude] turn ${session.call_scope ?? session.message_id} in chat ${session.chat_id} failed:`, error);
    await end.fail(error);
    return "ended";
  } finally {
    session.signal.removeEventListener("abort", stop);
    unwatch();
    shutdown();
    await query?.exited;
    await bridge.settled();
    rounds.close();
    rounds.flush();
  }
};

const resumable_ref = async (shared: TurnShared, session: TurnSession, input: ClaudeTurnInput): Promise<ClaudeSessionRef | null> => {
  const stored = input.stored;
  if (stored && claude_session_resumable(stored, session.project_root, input.previous_turn_id)) {
    return stored;
  }
  if (stored) {
    await drop_session(shared.runtime, session, input, stored);
  }
  return null;
};

export const run_claude_turn = async (session: TurnSession, input: ClaudeTurnInput): Promise<void> => {
  const runtime = claude_runtime();
  const progress = { round: () => -1 };
  const end = create_turn_end(session, () => progress.round(), runtime.auth_failed);
  const shared: TurnShared = { runtime, end, progress, stop_state: { active: false }, opening: null, base: input.api_messages.length };
  try {
    if (session.signal.aborted) {
      end.finish("stopped");
      return;
    }
    const resume = await resumable_ref(shared, session, input);
    if (input.compact_only && !resume) {
      end.finish("failed", { kind: "internal", message: no_session_text });
      return;
    }
    const outcome = await run_attempt(session, input, shared, resume);
    if (outcome !== "ended" && resume) {
      await drop_session(runtime, session, input, resume);
    }
    if (outcome !== "missing") {
      return;
    }
    if (input.compact_only) {
      end.finish("failed", { kind: "internal", message: no_session_text });
      return;
    }
    await run_attempt(session, input, shared, null);
  } catch (error) {
    if (session.signal.aborted) {
      end.finish("stopped");
    } else {
      console.error(`[claude] turn ${session.call_scope ?? session.message_id} in chat ${session.chat_id} failed before Claude Code ran:`, error);
      await end.fail(error);
    }
  } finally {
    await end.done;
  }
};
