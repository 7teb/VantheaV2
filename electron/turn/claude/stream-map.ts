import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKRateLimitInfo,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { create_draft_decoder } from "../../model/draft-decoder.ts";
import { is_record } from "../../storage/coerce.ts";
import type { CompactionError } from "../../../shared/chat.ts";
import type { TurnSession } from "../session.ts";
import type { CallRegistry } from "./calls.ts";
import type { CompactionTracker } from "./compaction.ts";
import { blocked_limit, extra_usage, type ClaudeFacts } from "./errors.ts";
import type { InputChannel } from "./input.ts";
import { bare_name, silent_tools } from "./names.ts";
import type { Round, Rounds } from "./rounds.ts";

export type MapAction =
  | { kind: "none" }
  | { kind: "init"; message: SDKSystemMessage }
  | { kind: "limit"; info: SDKRateLimitInfo }
  | { kind: "compacted" }
  | { kind: "compact_failed"; error: CompactionError }
  | { kind: "result"; result: SDKResultMessage };

type StreamMapDeps = {
  session: TurnSession;
  rounds: Rounds;
  calls: CallRegistry;
  input: InputChannel;
  compaction: CompactionTracker;
};

export type StreamMap = { feed: (message: SDKMessage) => MapAction; facts: () => ClaudeFacts };

type TextKind = "text" | "thinking";

type TextBlock = { kind: TextKind; delivered: string };

type Block = TextBlock | { kind: "tool"; position: number } | { kind: "other" };

type Response = { round: Round; blocks: Map<number, Block>; streamed: Record<TextKind, TextBlock[]>; seen: Record<TextKind, number> };

type StreamEvent = SDKPartialAssistantMessage["event"];

type AssistantBlock = SDKAssistantMessage["message"]["content"][number];

type ToolUseBlock = Extract<AssistantBlock, { type: "tool_use" }>;

type ToolResultContent = Extract<Exclude<SDKUserMessage["message"]["content"], string>[number], { type: "tool_result" }>["content"];

const synthetic_model = "<synthetic>";

const replaced_reason = "response replaced";

const none: MapAction = { kind: "none" };

const block_text = (content: AssistantBlock[]): string => content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");

const tool_result_text = (content: ToolResultContent): string => {
  if (typeof content === "string") {
    return content;
  }
  return (content ?? []).flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
};

const uuids_of = (message: { user_message_uuids?: string[]; user_message_uuid?: string }): string[] =>
  message.user_message_uuids ?? (message.user_message_uuid ? [message.user_message_uuid] : []);

export const create_stream_map = (deps: StreamMapDeps): StreamMap => {
  const { session, rounds, calls, input, compaction } = deps;
  const responses = new Map<string, Response>();
  const uuid_rounds = new Map<string, number>();
  const facts: ClaudeFacts = { assistant_error: null, assistant_text: "", limit: null };
  const unhandled = new Set<string>();
  let streaming: Response | null = null;

  const response_for = (round: Round): Response => ({ round, blocks: new Map(), streamed: { text: [], thinking: [] }, seen: { text: 0, thinking: 0 } });

  const start_tool = (round: Round, id: string, name: string): number => {
    const position = round.next_tool;
    round.next_tool += 1;
    round.tools.set(position, { call: { index: position, id, name, arguments: "" }, decoder: create_draft_decoder(name) });
    calls.start(id, name, round.number, position);
    return position;
  };

  const block_start = (response: Response, event: Extract<StreamEvent, { type: "content_block_start" }>) => {
    const block = event.content_block;
    if (block.type === "text" || block.type === "thinking") {
      const entry: TextBlock = { kind: block.type, delivered: "" };
      response.blocks.set(event.index, entry);
      response.streamed[block.type].push(entry);
      return;
    }
    if (block.type === "tool_use") {
      const name = bare_name(block.name);
      response.blocks.set(event.index, silent_tools.has(name) ? { kind: "other" } : { kind: "tool", position: start_tool(response.round, block.id, name) });
      return;
    }
    response.blocks.set(event.index, { kind: "other" });
  };

  const block_delta = (response: Response, event: Extract<StreamEvent, { type: "content_block_delta" }>) => {
    const block = response.blocks.get(event.index);
    const round = response.round;
    const delta = event.delta;
    if (delta.type === "text_delta" && block?.kind === "text") {
      round.drafts.flush(true);
      block.delivered += delta.text;
      round.callbacks.on_text(delta.text);
      return;
    }
    if (delta.type === "thinking_delta" && block?.kind === "thinking") {
      round.drafts.flush(true);
      block.delivered += delta.thinking;
      round.callbacks.on_reasoning(delta.thinking);
      return;
    }
    if (delta.type === "input_json_delta" && block?.kind === "tool") {
      const draft = round.tools.get(block.position);
      if (draft) {
        draft.call.arguments += delta.partial_json;
        draft.decoder?.feed(delta.partial_json);
        round.drafts.note([block.position]);
      }
    }
  };

  const on_stream = (message: SDKPartialAssistantMessage) => {
    if (message.parent_tool_use_id !== null) {
      return;
    }
    input.acknowledge(uuids_of(message));
    const event = message.event;
    if (event.type === "message_start") {
      calls.streaming(true);
      const response = response_for(rounds.begin(event.message.usage));
      responses.set(event.message.id, response);
      streaming = response;
      return;
    }
    if (!streaming) {
      return;
    }
    if (event.type === "content_block_start") {
      block_start(streaming, event);
    } else if (event.type === "content_block_delta") {
      block_delta(streaming, event);
    } else if (event.type === "message_delta") {
      rounds.usage(event.usage);
      if (event.delta.stop_reason) {
        rounds.complete(event.delta.stop_reason);
        calls.streaming(false);
      }
    } else if (event.type === "message_stop") {
      calls.streaming(false);
      rounds.stop();
      return;
    }
    streaming.round.drafts.flush(false);
  };

  const complete_text = (response: Response, kind: TextKind, text: string) => {
    const order = response.seen[kind];
    response.seen[kind] += 1;
    const streamed = response.streamed[kind][order];
    const delivered = streamed?.delivered ?? "";
    if (!text.startsWith(delivered)) {
      console.warn(`[claude] a ${kind} block of round ${response.round.number} in chat ${session.chat_id} differs from its streamed text, keeping the streamed text`);
      return;
    }
    const rest = text.slice(delivered.length);
    if (!rest) {
      return;
    }
    if (streamed) {
      streamed.delivered = text;
    }
    if (kind === "text") {
      response.round.callbacks.on_text(rest);
    } else {
      response.round.callbacks.on_reasoning(rest);
    }
  };

  const announce_tool = (response: Response, block: ToolUseBlock) => {
    const name = bare_name(block.name);
    if (silent_tools.has(name)) {
      return;
    }
    if (!calls.known(block.id)) {
      start_tool(response.round, block.id, name);
    }
    calls.announce(block.id, is_record(block.input) ? block.input : {});
  };

  const supersede = (uuids: string[]) => {
    const replaced = new Set(uuids.flatMap((uuid) => (uuid_rounds.has(uuid) ? [uuid_rounds.get(uuid) ?? 0] : [])));
    for (const round of replaced) {
      rounds.retry(round, 1, 1, replaced_reason, 0);
    }
  };

  const on_assistant = (message: SDKAssistantMessage) => {
    if (message.parent_tool_use_id !== null) {
      return;
    }
    input.acknowledge(uuids_of(message));
    if (message.error) {
      facts.assistant_error = message.error;
    }
    if (message.supersedes?.length) {
      supersede(message.supersedes);
    }
    if (message.message.model === synthetic_model) {
      facts.assistant_text = block_text(message.message.content) || facts.assistant_text;
      return;
    }
    const known = responses.get(message.message.id);
    const response = known ?? response_for(rounds.open_round());
    if (!known) {
      responses.set(message.message.id, response);
    }
    uuid_rounds.set(message.uuid, response.round.number);
    for (const block of message.message.content) {
      if (block.type === "text") {
        complete_text(response, "text", block.text);
      } else if (block.type === "thinking") {
        complete_text(response, "thinking", block.thinking);
      } else if (block.type === "tool_use") {
        announce_tool(response, block);
      }
    }
  };

  const on_user = (message: Extract<SDKMessage, { type: "user" }>) => {
    const content = message.message.content;
    if (message.parent_tool_use_id !== null || typeof content === "string") {
      return;
    }
    for (const block of content) {
      if (block.type === "tool_result") {
        calls.close(block.tool_use_id, "failed", tool_result_text(block.content) || "Claude Code answered this call without running the tool.");
      }
    }
  };

  const on_limit = (info: SDKRateLimitInfo): MapAction => {
    facts.limit = info;
    return blocked_limit(info) || extra_usage(info) ? { kind: "limit", info } : none;
  };

  const log_unhandled = (message: SDKMessage) => {
    const name = "subtype" in message ? `${message.type}/${String(message.subtype)}` : message.type;
    if (unhandled.has(name)) {
      return;
    }
    unhandled.add(name);
    console.info(`[claude] chat ${session.chat_id} ignores Claude Code messages of type ${name}`);
  };

  const feed = (message: SDKMessage): MapAction => {
    switch (message.type) {
      case "stream_event":
        on_stream(message);
        return none;
      case "assistant":
        on_assistant(message);
        return none;
      case "user":
        on_user(message);
        return none;
      case "rate_limit_event":
        return on_limit(message.rate_limit_info);
      case "result":
        calls.streaming(false);
        rounds.flush();
        input.acknowledge(uuids_of(message));
        return { kind: "result", result: message };
    }
    if (message.type === "system") {
      if (message.subtype === "init") {
        return { kind: "init", message };
      }
      if (message.subtype === "status") {
        const failed = compaction.status(message);
        return failed ? { kind: "compact_failed", error: failed } : none;
      }
      if (message.subtype === "compact_boundary") {
        compaction.boundary(message);
        return { kind: "compacted" };
      }
      if (message.subtype === "api_retry") {
        const current = rounds.current();
        rounds.retry(current && !current.completed ? current.number : rounds.number() + 1, message.attempt, message.max_retries, message.error, message.retry_delay_ms);
        return none;
      }
      if (message.subtype === "permission_denied") {
        calls.close(message.tool_use_id, "denied", message.message);
        return none;
      }
    }
    log_unhandled(message);
    return none;
  };

  return { feed, facts: () => facts };
};
