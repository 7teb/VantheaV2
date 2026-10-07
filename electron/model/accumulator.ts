import { create_content_splitter } from "./content-split.ts";
import { read_provider_error, type ProviderError } from "./errors.ts";
import { as_number, as_record, as_string, type JsonRecord } from "./json.ts";
import { recover_tool_calls } from "./recover.ts";
import type { RoundToolCall, RoundUsage } from "./types.ts";

export type ChunkOutcome = {
  text: string;
  reasoning: string;
  drafted: number[];
  error: ProviderError | null;
  finish_reason: string;
};

export type Assembly = {
  flushed_text: string;
  flushed_reasoning: string;
  content: string;
  reasoning: string;
  reasoning_details: unknown[];
  tool_calls: RoundToolCall[];
  finish_reason: string;
  usage: RoundUsage | null;
};

export type Accumulator = {
  push(chunk: unknown): ChunkOutcome;
  tool(index: number): RoundToolCall | null;
  finish_reason(): string;
  content(): string;
  reasoning(): string;
  finish(known_tools: Set<string>, make_id: () => string): Assembly;
};

const concatenated_fields = new Set(["text", "summary"]);

const draft_line_fields: Record<string, string> = { write_file: "content", replace_in_file: "new_string" };

export const draft_lines = (name: string, args: string): number | null => {
  const field = draft_line_fields[name];
  if (!field) {
    return null;
  }
  const start = new RegExp(`"${field}"\\s*:\\s*"`).exec(args);
  if (!start) {
    return 0;
  }
  let breaks = 0;
  let chars = 0;
  for (let index = start.index + start[0].length; index < args.length; index += 1) {
    const char = args[index];
    if (char === '"') {
      break;
    }
    chars += 1;
    if (char === "\\") {
      breaks += args[index + 1] === "n" ? 1 : 0;
      index += 1;
    }
  }
  return chars ? breaks + 1 : 0;
};

export const read_usage = (value: unknown): RoundUsage | null => {
  const usage = as_record(value);
  const prompt_tokens = as_number(usage?.prompt_tokens);
  const completion_tokens = as_number(usage?.completion_tokens);
  if (prompt_tokens === null || completion_tokens === null) {
    return null;
  }
  const reasoning_tokens = as_number(as_record(usage?.completion_tokens_details)?.reasoning_tokens) ?? 0;
  return { prompt_tokens, completion_tokens, reasoning_tokens };
};

const merge_name = (current: string, incoming: string): string => (!current || incoming.startsWith(current) ? incoming : current + incoming);

const merge_detail = (details: JsonRecord[], raw: unknown) => {
  const item = as_record(raw);
  if (!item || typeof item.type !== "string") {
    return;
  }
  const last = details.at(-1);
  if (!last || item.type === "reasoning.encrypted" || last.type !== item.type || last.index !== item.index) {
    details.push({ ...item });
    return;
  }
  for (const [key, value] of Object.entries(item)) {
    if (concatenated_fields.has(key) && typeof value === "string") {
      last[key] = as_string(last[key]) + value;
    } else if (value !== null && value !== undefined && value !== "") {
      last[key] = value;
    }
  }
};

const details_text = (details: unknown[]): string =>
  details
    .map((raw) => {
      const item = as_record(raw);
      return as_string(item?.type === "reasoning.summary" ? item.summary : item?.text);
    })
    .join("");

export const create_accumulator = (): Accumulator => {
  const splitter = create_content_splitter();
  const tools = new Map<number, RoundToolCall>();
  const details: JsonRecord[] = [];
  let content = "";
  let reasoning = "";
  let finish_reason = "";
  let usage: RoundUsage | null = null;

  const fold_tool = (raw: unknown): number | null => {
    const part = as_record(raw);
    if (!part) {
      return null;
    }
    const index = as_number(part.index) ?? 0;
    const fn = as_record(part.function);
    const current = tools.get(index) ?? { index, id: "", name: "", arguments: "" };
    const id = as_string(part.id);
    const name = as_string(fn?.name);
    current.id ||= id;
    current.name = name ? merge_name(current.name, name) : current.name;
    current.arguments += as_string(fn?.arguments);
    tools.set(index, current);
    return index;
  };

  const push = (chunk: unknown): ChunkOutcome => {
    const out: ChunkOutcome = { text: "", reasoning: "", drafted: [], error: null, finish_reason: "" };
    const body = as_record(chunk);
    if (!body) {
      return out;
    }
    if (body.error !== undefined && body.error !== null) {
      out.error = read_provider_error(body.error) ?? read_provider_error({ message: JSON.stringify(body.error).slice(0, 300) });
    }
    usage = read_usage(body.usage) ?? usage;
    const choice = as_record(Array.isArray(body.choices) ? body.choices[0] : null);
    if (!choice) {
      return out;
    }
    const delta = as_record(choice.delta) ?? {};
    const delta_details = Array.isArray(delta.reasoning_details) ? delta.reasoning_details : [];
    for (const raw of delta_details) {
      merge_detail(details, raw);
    }
    const split = splitter.push(as_string(delta.content));
    out.reasoning = (as_string(delta.reasoning) || details_text(delta_details)) + split.reasoning;
    out.text = split.text + as_string(delta.refusal);
    content += out.text;
    reasoning += out.reasoning;
    for (const raw of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      const index = fold_tool(raw);
      if (index !== null && !out.drafted.includes(index)) {
        out.drafted.push(index);
      }
    }
    out.finish_reason = as_string(choice.finish_reason);
    finish_reason = out.finish_reason || finish_reason;
    return out;
  };

  const finish = (known_tools: Set<string>, make_id: () => string): Assembly => {
    const end = splitter.finish();
    const structured = [...tools.values()].sort((a, b) => a.index - b.index);
    for (const call of structured.filter((entry) => !entry.name)) {
      console.warn(`[model] dropped tool call ${call.index} without a name, arguments: ${call.arguments.slice(0, 200)}`);
    }
    let calls = structured.filter((entry) => entry.name);
    let flushed_text = end.text;
    if (end.held && !calls.length) {
      const recovered = recover_tool_calls(end.held, known_tools);
      calls = recovered.calls.map((call, index) => ({ index, id: "", ...call }));
      flushed_text += recovered.rest;
    } else {
      flushed_text += end.held;
    }
    content += flushed_text;
    reasoning += end.reasoning;
    return {
      flushed_text,
      flushed_reasoning: end.reasoning,
      content,
      reasoning,
      reasoning_details: details,
      tool_calls: calls.map((call) => ({ ...call, id: call.id || make_id() })),
      finish_reason,
      usage,
    };
  };

  return {
    push,
    tool: (index) => tools.get(index) ?? null,
    finish_reason: () => finish_reason,
    content: () => content,
    reasoning: () => reasoning,
    finish,
  };
};
