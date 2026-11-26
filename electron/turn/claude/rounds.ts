import type { SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import { context_usage } from "../../context/calibration.ts";
import type { DraftDecoder } from "../../model/draft-decoder.ts";
import { create_draft_reporter } from "../../model/stream.ts";
import type { ApiAssistantMessage, ApiMessage, RoundCallbacks, RoundToolCall } from "../../model/types.ts";
import { api_call_id } from "../call.ts";
import { carrier } from "../carriers.ts";
import { create_status_driver, type StatusDriver } from "../reasoning-status.ts";
import type { TurnSession } from "../session.ts";
import type { CallRegistry } from "./calls.ts";

type StreamEvent = SDKPartialAssistantMessage["event"];

type StartUsage = Extract<StreamEvent, { type: "message_start" }>["message"]["usage"];

type DeltaUsage = Extract<StreamEvent, { type: "message_delta" }>["usage"];

type Tokens = { input: number; output: number; cache_read: number; cache_creation: number };

type ToolDraft = { call: RoundToolCall; decoder: DraftDecoder | null };

type DraftReporter = ReturnType<typeof create_draft_reporter>;

export type Round = {
  number: number;
  completed: boolean;
  retried: boolean;
  text: string;
  reasoning: string;
  tokens: Tokens;
  next_tool: number;
  tools: Map<number, ToolDraft>;
  callbacks: RoundCallbacks;
  drafts: DraftReporter;
  status: StatusDriver | null;
  flushed: boolean;
};

export type Rounds = {
  begin: (usage: StartUsage) => Round;
  open_round: () => Round;
  current: () => Round | null;
  number: () => number;
  usage: (usage: DeltaUsage) => void;
  complete: (stop_reason: string) => void;
  stop: () => void;
  retry: (round: number, attempt: number, max: number, reason: string, wait_ms: number) => void;
  flush: () => void;
  hold: (messages: ApiMessage[]) => void;
  completed_count: () => number;
  last_text: () => string;
  used: () => number;
  close: () => void;
};

const restart_reason = "response restarted";

const finish_reasons: Record<string, string> = { end_turn: "stop", tool_use: "tool_calls", max_tokens: "length", refusal: "content_filter" };

const start_tokens = (usage: StartUsage | null): Tokens => ({
  input: usage?.input_tokens ?? 0,
  output: usage?.output_tokens ?? 0,
  cache_read: usage?.cache_read_input_tokens ?? 0,
  cache_creation: usage?.cache_creation_input_tokens ?? 0,
});

export const create_rounds = (session: TurnSession, api_messages: ApiMessage[], calls: CallRegistry): Rounds => {
  const scope = session.call_scope ?? session.message_id;
  const held: ApiMessage[] = [];
  let current: Round | null = null;
  let completed = 0;
  let last_text = "";
  let used = 0;

  const make_round = (number: number, usage: StartUsage | null): Round => {
    const status = create_status_driver(session, number);
    const tools = new Map<number, ToolDraft>();
    const callbacks: RoundCallbacks = {
      on_text: (delta) => {
        status?.close();
        round.text += delta;
        session.emit({ type: "text", round: number, delta });
      },
      on_reasoning: (delta) => {
        round.reasoning += delta;
        session.emit({ type: "reasoning", round: number, delta });
        status?.reasoning(delta);
      },
      on_tool_draft: (index, name, draft) => {
        status?.close();
        session.emit({ type: "tool_draft", round: number, index, name, ...draft });
      },
      on_retry: (attempt, max, reason, wait_ms) => {
        status?.drop();
        round.text = "";
        round.reasoning = "";
        round.retried = true;
        session.emit({ type: "retry", round: number, attempt, max, reason, wait_ms });
      },
    };
    const drafts = create_draft_reporter({ tool: (index) => tools.get(index)?.call ?? null, draft: (index) => tools.get(index)?.decoder ?? null }, callbacks, Date.now);
    const round: Round = { number, completed: false, retried: false, text: "", reasoning: "", tokens: start_tokens(usage), next_tool: 0, tools, callbacks, drafts, status, flushed: false };
    return round;
  };

  const flush = () => {
    const round = current;
    if (round && !round.flushed) {
      round.flushed = true;
      const entries = calls.of_round(round.number);
      const assistant: ApiAssistantMessage = { role: "assistant", content: round.text || null };
      if (entries.length) {
        assistant.tool_calls = entries.map((entry) => ({
          id: api_call_id(scope, entry.call_id),
          type: "function",
          function: { name: entry.name, arguments: JSON.stringify(entry.input ?? {}) },
        }));
      }
      if (round.reasoning) {
        assistant.reasoning = round.reasoning;
      }
      api_messages.push(assistant);
      for (const entry of entries) {
        if (entry.result) {
          api_messages.push({ role: "tool", tool_call_id: api_call_id(scope, entry.call_id), content: entry.result.text });
        }
      }
      const carried = entries.flatMap((entry) => entry.result?.carried ?? []);
      if (carried.length) {
        api_messages.push(carrier(carried));
      }
    }
    api_messages.push(...held.splice(0));
  };

  const next_round = (usage: StartUsage | null): Round => {
    flush();
    current?.status?.close();
    current = make_round((current?.number ?? -1) + 1, usage);
    return current;
  };

  return {
    begin: (usage) => {
      const open = current;
      if (!open || open.completed || calls.announced_in(open.number) > 0) {
        return next_round(usage);
      }
      if (!open.retried) {
        open.callbacks.on_retry(1, 1, restart_reason, 0);
      }
      calls.forget_open(open.number);
      open.status?.drop();
      current = make_round(open.number, usage);
      return current;
    },
    open_round: () => next_round(null),
    current: () => current,
    number: () => current?.number ?? -1,
    usage: (usage) => {
      if (!current) {
        return;
      }
      const tokens = current.tokens;
      current.tokens = {
        input: usage.input_tokens ?? tokens.input,
        output: usage.output_tokens ?? tokens.output,
        cache_read: usage.cache_read_input_tokens ?? tokens.cache_read,
        cache_creation: usage.cache_creation_input_tokens ?? tokens.cache_creation,
      };
    },
    complete: (stop_reason) => {
      if (!current || current.completed) {
        return;
      }
      current.completed = true;
      completed += 1;
      last_text = current.text;
      session.finished?.(finish_reasons[stop_reason] ?? stop_reason);
    },
    stop: () => {
      if (!current) {
        return;
      }
      current.drafts.flush(true);
      current.status?.close();
      const { input, output, cache_read, cache_creation } = current.tokens;
      const prompt = input + cache_read + cache_creation;
      used = prompt + output;
      session.emit({ type: "usage", round: current.number, prompt_tokens: prompt, completion_tokens: output, reasoning_tokens: 0, cached_tokens: cache_read, cache_write_tokens: cache_creation });
      session.emit({ type: "context", usage: context_usage(used, session.model, null, 0) });
    },
    retry: (round, attempt, max, reason, wait_ms) => {
      if (current && current.number === round) {
        current.callbacks.on_retry(attempt, max, reason, wait_ms);
        return;
      }
      current?.status?.drop();
      session.emit({ type: "retry", round, attempt, max, reason, wait_ms });
    },
    flush,
    hold: (messages) => {
      if (current && !current.flushed) {
        held.push(...messages);
        return;
      }
      api_messages.push(...messages);
    },
    completed_count: () => completed,
    last_text: () => last_text,
    used: () => used,
    close: () => current?.status?.close(),
  };
};
