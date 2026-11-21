import { create_draft_decoder, type DraftDecoder, type DraftSource } from "../draft-decoder.ts";
import { ModelError } from "../errors.ts";
import { as_number, as_record, as_string, type JsonRecord } from "../json.ts";
import type { RoundToolCall, RoundUsage } from "../types.ts";
import type { PlanErrorBody } from "./errors.ts";
import { wrap_output } from "./input.ts";

type PlanTerminal = "completed" | "incomplete";

export type PlanPush = { text: string; reasoning: string; drafted: number[]; terminal: PlanTerminal | null; failure: PlanErrorBody | null };

type PlanAssembly = {
  content: string;
  reasoning: string;
  reasoning_details: unknown[];
  tool_calls: RoundToolCall[];
  finish_reason: string;
  usage: RoundUsage | null;
  response_id: string | null;
  cached_tokens: number;
  cache_write_tokens: number;
};

export type PlanAccumulator = {
  push(event: unknown): PlanPush;
  tool(index: number): RoundToolCall | null;
  draft(index: number): DraftSource | null;
  content(): string;
  reasoning(): string;
  finish(make_id: () => string): PlanAssembly;
};

const part_gap = "\n\n";

const output_index_of = (event: JsonRecord): number | null => {
  const value = as_number(event.output_index);
  return value !== null && Number.isInteger(value) && value >= 0 ? value : null;
};

const failure_of = (value: JsonRecord | null): PlanErrorBody => ({
  code: as_string(value?.code),
  message: as_string(value?.message),
  param: as_string(value?.param),
  type: "",
});

export const create_plan_accumulator = (): PlanAccumulator => {
  const tools = new Map<number, RoundToolCall>();
  const tool_by_item = new Map<string, RoundToolCall>();
  const tool_by_output = new Map<number, RoundToolCall>();
  const drafts = new Map<number, DraftDecoder>();
  const done_items: JsonRecord[] = [];
  let content = "";
  let reasoning = "";
  let text_item = "";
  let reasoning_gap = false;
  let refused = false;
  let terminal: PlanTerminal | null = null;
  let incomplete_reason = "";
  let usage: RoundUsage | null = null;
  let response_id: string | null = null;
  let cached_tokens = 0;
  let cache_write_tokens = 0;

  const add_text = (event: JsonRecord, delta: string): string => {
    if (!delta) {
      return "";
    }
    const item = as_string(event.item_id) || String(output_index_of(event) ?? "");
    const piece = content && item !== text_item ? `${part_gap}${delta}` : delta;
    text_item = item;
    content += piece;
    return piece;
  };

  const add_reasoning = (delta: string): string => {
    if (!delta) {
      return "";
    }
    const piece = reasoning_gap && reasoning ? `${part_gap}${delta}` : delta;
    reasoning_gap = false;
    reasoning += piece;
    return piece;
  };

  const register_tool = (item: JsonRecord, output_index: number | null): RoundToolCall => {
    const call: RoundToolCall = { index: tools.size, id: as_string(item.call_id), name: as_string(item.name), arguments: "" };
    tools.set(call.index, call);
    const item_id = as_string(item.id);
    if (item_id) {
      tool_by_item.set(item_id, call);
    }
    if (output_index !== null) {
      tool_by_output.set(output_index, call);
    }
    const decoder = create_draft_decoder(call.name);
    if (decoder) {
      drafts.set(call.index, decoder);
    }
    return call;
  };

  const tool_of = (item_id: string, output_index: number | null): RoundToolCall | null =>
    (item_id ? tool_by_item.get(item_id) : undefined) ?? (output_index === null ? undefined : tool_by_output.get(output_index)) ?? null;

  const append_arguments = (call: RoundToolCall, piece: string, out: PlanPush) => {
    if (!piece) {
      return;
    }
    call.arguments += piece;
    drafts.get(call.index)?.feed(piece);
    if (!out.drafted.includes(call.index)) {
      out.drafted.push(call.index);
    }
  };

  const settle_arguments = (call: RoundToolCall, final: string, out: PlanPush) => {
    if (!final || final === call.arguments) {
      return;
    }
    if (final.startsWith(call.arguments)) {
      append_arguments(call, final.slice(call.arguments.length), out);
      return;
    }
    call.arguments = final;
  };

  const start_item = (event: JsonRecord, out: PlanPush) => {
    const item = as_record(event.item);
    if (item?.type !== "function_call") {
      return;
    }
    const call = register_tool(item, output_index_of(event));
    out.drafted.push(call.index);
    append_arguments(call, as_string(item.arguments), out);
  };

  const finish_item = (event: JsonRecord, out: PlanPush) => {
    const item = as_record(event.item);
    if (!item) {
      return;
    }
    const output_index = output_index_of(event);
    done_items[output_index ?? done_items.length] = item;
    if (item.type !== "function_call") {
      return;
    }
    const call = tool_of(as_string(item.id), output_index) ?? register_tool(item, output_index);
    settle_arguments(call, as_string(item.arguments), out);
    call.name = as_string(item.name) || call.name;
    call.id = as_string(item.call_id) || call.id;
  };

  const read_response = (event: JsonRecord): JsonRecord | null => {
    const response = as_record(event.response);
    response_id = as_string(response?.id) || response_id;
    const raw = as_record(response?.usage);
    if (!raw) {
      return response;
    }
    const input_tokens = as_number(raw.input_tokens);
    const output_tokens = as_number(raw.output_tokens);
    if (input_tokens !== null && output_tokens !== null) {
      usage = { prompt_tokens: input_tokens, completion_tokens: output_tokens, reasoning_tokens: as_number(as_record(raw.output_tokens_details)?.reasoning_tokens) ?? 0 };
    }
    const input_details = as_record(raw.input_tokens_details);
    cached_tokens = as_number(input_details?.cached_tokens) ?? 0;
    cache_write_tokens = as_number(input_details?.cache_write_tokens) ?? 0;
    return response;
  };

  const push = (raw: unknown): PlanPush => {
    const out: PlanPush = { text: "", reasoning: "", drafted: [], terminal: null, failure: null };
    const event = as_record(raw);
    if (!event) {
      return out;
    }
    switch (as_string(event.type)) {
      case "response.created":
      case "response.in_progress":
        read_response(event);
        break;
      case "response.output_text.delta":
        out.text = add_text(event, as_string(event.delta));
        break;
      case "response.refusal.delta":
        refused = true;
        out.text = add_text(event, as_string(event.delta));
        break;
      case "response.reasoning_summary_part.added":
        reasoning_gap ||= Boolean(reasoning);
        break;
      case "response.reasoning_summary_text.delta":
      case "response.reasoning_text.delta":
        out.reasoning = add_reasoning(as_string(event.delta));
        break;
      case "response.output_item.added":
        start_item(event, out);
        break;
      case "response.function_call_arguments.delta": {
        const call = tool_of(as_string(event.item_id), output_index_of(event));
        if (call) {
          append_arguments(call, as_string(event.delta), out);
        }
        break;
      }
      case "response.function_call_arguments.done": {
        const call = tool_of(as_string(event.item_id), output_index_of(event));
        if (call) {
          settle_arguments(call, as_string(event.arguments), out);
        }
        break;
      }
      case "response.output_item.done":
        finish_item(event, out);
        break;
      case "response.completed":
        read_response(event);
        terminal = "completed";
        out.terminal = terminal;
        break;
      case "response.incomplete":
        incomplete_reason = as_string(as_record(read_response(event)?.incomplete_details)?.reason);
        terminal = "incomplete";
        out.terminal = terminal;
        break;
      case "response.failed":
        out.failure = failure_of(as_record(read_response(event)?.error));
        break;
      case "error":
        out.failure = failure_of(as_record(event.error) ?? event);
        break;
    }
    return out;
  };

  const finish_reason = (calls: number): string => {
    if (terminal === "incomplete") {
      if (incomplete_reason === "max_output_tokens") {
        return "length";
      }
      if (incomplete_reason === "content_filter") {
        return "content_filter";
      }
      throw new ModelError("bad_request", `ChatGPT plan: the response ended incomplete (${incomplete_reason || "no reason given"}).`);
    }
    if (calls) {
      return "tool_calls";
    }
    return refused ? "content_filter" : "stop";
  };

  const finish = (make_id: () => string): PlanAssembly => {
    const named = [...tools.values()].filter((call) => {
      if (!call.name) {
        console.warn(`[plan] dropped tool call ${call.index} without a name, arguments: ${call.arguments.slice(0, 200)}`);
      }
      return Boolean(call.name);
    });
    const tool_calls = named.map((call) => ({ ...call, id: call.id || make_id() }));
    const items = done_items.filter((item) => item !== undefined);
    return {
      content,
      reasoning,
      reasoning_details: terminal === "completed" && items.length ? wrap_output(items) : [],
      tool_calls,
      finish_reason: finish_reason(tool_calls.length),
      usage,
      response_id,
      cached_tokens,
      cache_write_tokens,
    };
  };

  return {
    push,
    tool: (index) => tools.get(index) ?? null,
    draft: (index) => drafts.get(index) ?? null,
    content: () => content,
    reasoning: () => reasoning,
    finish,
  };
};
