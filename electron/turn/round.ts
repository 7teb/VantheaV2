import type { ContextCalibration } from "../../shared/chat.ts";
import { calibrate, calibration_scale, measure_request, output_budget, sent_estimate } from "../context/calibration.ts";
import { next_compaction } from "../context/compact.ts";
import { fit_images, image_slots, shrink_images } from "../context/images.ts";
import { shrunk_data_url } from "../media/fitted-image.ts";
import { image_limit } from "../model/image-limits.ts";
import { reasoning_bound_to_prefix } from "../model/prompt-cache.ts";
import { round_body } from "../model/stream.ts";
import type { ApiAssistantMessage, ApiMessage, ApiToolCall, RoundRequest, RoundResult, RoundUsage } from "../model/types.ts";
import type { ContextReading, ToolProfile } from "../tools/types.ts";
import { tool_batches } from "./batches.ts";
import { api_call_id, engine_call_id, parse_args, run_call, type EngineCall } from "./call.ts";
import { carrier, type CarrierImage } from "./carriers.ts";
import { create_status_driver } from "./reasoning-status.ts";
import type { TurnSession } from "./session.ts";

export { api_call_id } from "./call.ts";

export type RoundOutcome = {
  aborted: boolean;
  tool_calls: number;
  finish_reason: string;
  usage: RoundUsage | null;
  estimate: number;
  plan_presented: boolean;
  text: string;
};

const assistant_api_message = (result: RoundResult): ApiAssistantMessage => {
  const assistant: ApiAssistantMessage = { role: "assistant", content: result.content || null };
  if (result.reasoning_details.length) {
    assistant.reasoning_details = result.reasoning_details;
  } else if (result.reasoning) {
    assistant.reasoning = result.reasoning;
  }
  return assistant;
};

export const fit_request = async (request: RoundRequest): Promise<void> => {
  const limit = image_limit(request.model);
  const bound = reasoning_bound_to_prefix(request.model.id);
  await shrink_images(request.messages, limit, shrunk_data_url, bound);
  fit_images(request.messages, limit, () => Buffer.byteLength(JSON.stringify(round_body(request))), bound);
};

const aborted_outcome = (result: RoundResult, estimate: number): RoundOutcome => ({
  aborted: true,
  tool_calls: 0,
  finish_reason: result.finish_reason,
  usage: result.usage,
  estimate,
  plan_presented: false,
  text: result.content,
});

export const round_profile = (session: TurnSession): ToolProfile => session.profile ?? (session.plan ? "plan" : "main");

const stream_with_status = async (session: TurnSession, round: number, request: RoundRequest): Promise<RoundResult> => {
  const status = create_status_driver(session, round);
  try {
    return await session.stream(
      request,
      {
        on_text: (delta) => {
          status?.close();
          session.emit({ type: "text", round, delta });
        },
        on_reasoning: (delta) => {
          session.emit({ type: "reasoning", round, delta });
          status?.reasoning(delta);
        },
        on_tool_draft: (index, name, draft) => {
          status?.close();
          session.emit({ type: "tool_draft", round, index, name, ...draft });
        },
        on_retry: (attempt, max, reason, wait_ms) => {
          status?.drop();
          session.emit({ type: "retry", round, attempt, max, reason, wait_ms });
        },
      },
      session.signal,
    );
  } finally {
    status?.close();
  }
};

export const run_round = async (session: TurnSession, round: number, api_messages: ApiMessage[], calibration: ContextCalibration | null, floor: number): Promise<RoundOutcome> => {
  const profile = round_profile(session);
  const tools = session.resolve_tools(profile);
  const request: RoundRequest = {
    model: session.model,
    effort: session.effort,
    messages: api_messages,
    tools: tools.map((tool) => tool.spec),
    ...(session.cache_key ? { cache_key: session.cache_key } : {}),
  };
  await fit_request(request);
  const estimate = sent_estimate(request.messages, request.tools, session.model);
  request.max_tokens = output_budget(request.messages, request.tools, session.model, calibration);
  const result = await stream_with_status(session, round, request);
  const assistant = assistant_api_message(result);
  api_messages.push(assistant);
  if (result.status === "cancelled" || session.signal.aborted) {
    return aborted_outcome(result, estimate);
  }
  if (result.reasoning_details.length) {
    session.emit({ type: "reasoning_details", round, details: result.reasoning_details });
  }
  if (!result.tool_calls.length) {
    return { aborted: false, tool_calls: 0, finish_reason: result.finish_reason, usage: result.usage, estimate, plan_presented: false, text: result.content };
  }
  const scope = session.call_scope ?? session.message_id;
  const calls: EngineCall[] = result.tool_calls.map((call, position) => ({
    ...call,
    engine_id: engine_call_id(round, position),
    args: parse_args(call.arguments),
    tool: tools.find((entry) => entry.spec.name === call.name) ?? null,
  }));
  const api_calls: ApiToolCall[] = calls.map((call) => ({
    id: api_call_id(scope, call.engine_id),
    type: "function",
    function: { name: call.name, arguments: call.args && call.arguments.trim() ? call.arguments : "{}" },
  }));
  assistant.tool_calls = api_calls;
  for (const [position, call] of calls.entries()) {
    const args = call.args ?? {};
    const sent = api_calls[position].function.arguments;
    session.emit({ type: "tool_call", round, index: call.index, call_id: call.engine_id, name: call.name, args, ...(sent === JSON.stringify(args) ? {} : { arguments: sent }) });
  }
  try {
    await session.before_tools?.();
  } catch (error) {
    if (session.signal.aborted) return aborted_outcome(result, estimate);
    throw error;
  }
  const context = (): ContextReading => {
    const next = calibrate(result.usage, estimate) ?? calibration;
    const rescale = calibration_scale(next) / calibration_scale(calibration);
    return {
      used: measure_request(api_messages, request.tools, session.model, next),
      limit: session.model.context_length,
      compact_at: next_compaction(Math.ceil(floor * rescale), session.model),
    };
  };
  let plan_presented = false;
  const sent_images = image_slots(api_messages).length;
  const carried: CarrierImage[] = [];
  for (const batch of tool_batches(calls)) {
    if (session.signal.aborted) {
      return aborted_outcome(result, estimate);
    }
    const image_count = sent_images + carried.length + batch.length;
    const settled = await Promise.allSettled(batch.map((call) => run_call(session, call, profile, image_count, context)));
    let aborted = false;
    let rejected: PromiseRejectedResult | null = null;
    for (const [at, entry] of settled.entries()) {
      if (entry.status === "rejected") {
        rejected ??= entry;
        continue;
      }
      if (entry.value.aborted) {
        aborted = true;
        continue;
      }
      api_messages.push({ role: "tool", tool_call_id: api_call_id(scope, batch[at].engine_id), content: entry.value.result_text });
      carried.push(...entry.value.carried);
      plan_presented ||= entry.value.plan;
    }
    if (rejected) {
      throw rejected.reason;
    }
    if (aborted) {
      return aborted_outcome(result, estimate);
    }
  }
  if (carried.length) {
    api_messages.push(carrier(carried));
  }
  return { aborted: false, tool_calls: calls.length, finish_reason: result.finish_reason, usage: result.usage, estimate, plan_presented, text: result.content };
};
