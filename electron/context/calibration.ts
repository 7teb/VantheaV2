import type { AssistantMessage, ContextCalibration, ContextParts, ContextUsage, Message } from "../../shared/chat.ts";
import type { ModelEntry } from "../../shared/models.ts";
import { wire_messages, type ApiMessage, type RoundUsage } from "../model/types.ts";
import { is_record } from "../storage/coerce.ts";
import type { ToolSpec } from "../tools/types.ts";
import { estimate_messages, estimate_request, estimate_tools } from "./usage.ts";

export type StoredContext = { calibration: ContextCalibration | null; floor: number };

export const no_stored_context: StoredContext = { calibration: null, floor: 0 };

export const sent_estimate = (messages: ApiMessage[], specs: ToolSpec[], model: ModelEntry): number =>
  estimate_request(wire_messages(messages, model.reasoning_passback), specs);

const prompt_margin = 1.05;

const min_output_budget = 1024;

export const calibration_scale = (calibration: ContextCalibration | null): number => (calibration ? calibration.prompt_tokens / calibration.estimate : 1);

export const measure_request = (messages: ApiMessage[], specs: ToolSpec[], model: ModelEntry, calibration: ContextCalibration | null): number =>
  Math.ceil(sent_estimate(messages, specs, model) * calibration_scale(calibration));

export const output_budget = (messages: ApiMessage[], specs: ToolSpec[], model: ModelEntry, calibration: ContextCalibration | null): number | undefined => {
  const room = model.context_length - Math.ceil(measure_request(messages, specs, model, calibration) * prompt_margin);
  const budget = Math.min(model.max_output, room);
  return budget >= min_output_budget ? budget : undefined;
};

export const calibrate = (usage: RoundUsage | null, estimate: number): ContextCalibration | null =>
  usage && usage.prompt_tokens > 0 && estimate > 0 ? { prompt_tokens: usage.prompt_tokens, estimate } : null;

export const context_parts = (messages: ApiMessage[], specs: ToolSpec[], model: ModelEntry, used: number): ContextParts => {
  const wire = wire_messages(messages, model.reasoning_passback);
  const system = estimate_messages(wire.filter((message) => message.role === "system"));
  const tools = estimate_tools(specs);
  const total = system + tools + estimate_messages(wire.filter((message) => message.role !== "system"));
  const scale = total > 0 ? used / total : 0;
  const scaled = { system: Math.round(system * scale), tools: Math.round(tools * scale) };
  return { ...scaled, messages: Math.max(0, used - scaled.system - scaled.tools) };
};

export const context_usage = (used: number, model: ModelEntry, calibration: ContextCalibration | null, floor: number, parts?: ContextParts): ContextUsage => ({
  used,
  limit: model.context_length,
  ...(calibration ? { calibration } : {}),
  floor,
  ...(parts ? { parts } : {}),
});

export const stored_context = (messages: Message[], model_id: string): StoredContext => {
  const measured = messages.filter((message): message is AssistantMessage => message.role === "assistant" && message.context !== null);
  const newest = measured.at(-1);
  const source = measured.findLast((message) => message.model === model_id && message.context?.calibration);
  return {
    calibration: source?.context?.calibration ?? null,
    floor: newest?.model === model_id ? (newest.context?.floor ?? 0) : 0,
  };
};

const finite_at_least = (value: unknown, min: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min;

const positive = (value: unknown): value is number => finite_at_least(value, 0) && value > 0;

const coerce_calibration = (value: unknown): ContextCalibration | null =>
  is_record(value) && positive(value.prompt_tokens) && positive(value.estimate) ? { prompt_tokens: value.prompt_tokens, estimate: value.estimate } : null;

const coerce_parts = (value: unknown): ContextParts | null =>
  is_record(value) && finite_at_least(value.system, 0) && finite_at_least(value.tools, 0) && finite_at_least(value.messages, 0)
    ? { system: value.system, tools: value.tools, messages: value.messages }
    : null;

export const coerce_context_usage = (value: unknown): ContextUsage | null => {
  if (!is_record(value) || !finite_at_least(value.used, 0) || !finite_at_least(value.limit, 0)) {
    return null;
  }
  const calibration = coerce_calibration(value.calibration);
  const parts = coerce_parts(value.parts);
  return {
    used: value.used,
    limit: value.limit,
    ...(calibration ? { calibration } : {}),
    ...(finite_at_least(value.floor, 0) ? { floor: value.floor } : {}),
    ...(parts ? { parts } : {}),
  };
};
