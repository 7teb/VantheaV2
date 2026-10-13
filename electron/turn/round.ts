import type { StepImage, ToolProgress } from "../../shared/chat.ts";
import type { ToolEndStatus } from "../../shared/events.ts";
import { last_human_id, note_human_answer } from "../permissions/context.ts";
import { human_decision } from "../permissions/decisions.ts";
import { error_text } from "../storage/coerce.ts";
import { sent_estimate } from "../context/calibration.ts";
import { cap_text, result_cap_tokens } from "../context/estimate.ts";
import { fit_images, image_slots, shrink_images } from "../context/images.ts";
import type { ToolView } from "../../shared/tool-view.ts";
import { shrunk_data_url } from "../media/fitted-image.ts";
import { image_limit, image_rules } from "../model/image-limits.ts";
import { reasoning_bound_to_prefix } from "../model/prompt-cache.ts";
import { round_body } from "../model/stream.ts";
import type { ApiAssistantMessage, ApiMessage, ApiToolCall, RoundRequest, RoundResult, RoundToolCall, RoundUsage } from "../model/types.ts";
import type { Tool, ToolContext, ToolImage, ToolProfile } from "../tools/types.ts";
import { carrier, image_url, type CarrierImage } from "./carriers.ts";
import type { Emitter, TurnSession } from "./session.ts";

export type RoundOutcome = {
  aborted: boolean;
  tool_calls: number;
  finish_reason: string;
  usage: RoundUsage | null;
  estimate: number;
  plan_presented: boolean;
};

const progress_interval_ms = 100;

const engine_call_id = (round: number, index: number) => `c${round}_${index}`;

export const api_call_id = (scope: string, call_id: string) => `call_${scope.replace(/[^A-Za-z0-9]/g, "").slice(-8)}_${call_id}`;

const parse_args = (raw: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(raw.trim() || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    console.warn(`[turn] tool arguments are not a JSON object: ${raw.slice(0, 200)}`);
    return null;
  } catch (error) {
    console.warn(`[turn] tool arguments are not valid JSON (${error_text(error)}): ${raw.slice(0, 200)}`);
    return null;
  }
};

const invalid_args_text = (name: string) =>
  `The arguments for ${name} were not a valid JSON object, most often because the response hit the output length limit and was cut off. The tool did not run. Call it again with complete arguments, and split very large content across several smaller calls.`;

const assistant_api_message = (result: RoundResult): ApiAssistantMessage => {
  const assistant: ApiAssistantMessage = { role: "assistant", content: result.content || null };
  if (result.reasoning_details.length) {
    assistant.reasoning_details = result.reasoning_details;
  } else if (result.reasoning) {
    assistant.reasoning = result.reasoning;
  }
  return assistant;
};

const throttled_progress = (emit: Emitter, call_id: string): ((progress: ToolProgress) => void) => {
  let last = 0;
  let phase: ToolProgress["phase"];
  return (progress) => {
    if (progress.phase === phase) {
      const now = Date.now();
      if (now - last < progress_interval_ms) {
        return;
      }
      last = now;
    }
    phase = progress.phase;
    emit({ type: "tool_progress", call_id, progress });
  };
};

type ToolOutcome = { aborted: boolean; status: ToolEndStatus; result_text: string; view: ToolView | null; error: string | null; images: ToolImage[] };

type KeptImages = { stored: StepImage[]; carried: CarrierImage[]; note: string };

const images_left_out_note = "Older images were left out of this request to stay inside the model provider's documented limits.";

const build_context = (session: TurnSession, call_id: string, profile: ToolProfile, image_count: number): ToolContext => ({
  chat_id: session.chat_id,
  turn_id: session.message_id,
  call_id,
  project_root: session.project_root,
  user_request: session.user_request,
  human_decisions: session.human_decisions,
  get delegated_task() { return session.delegated_task; },
  mode: session.mode,
  profile,
  model: session.model,
  image_fit: image_rules(session.model, image_count),
  settings: session.settings,
  signal: session.signal,
  progress: throttled_progress(session.emit, call_id),
  approve: async (request) => {
    session.emit({ type: "tool_approval", call_id, request });
    const decision = await session.wait_decision(call_id, request);
    session.signal.throwIfAborted();
    const record = human_decision(request, decision, session.review.actor, last_human_id(session.chat_id));
    session.emit({ type: "tool_decision", call_id, decision: record });
    note_human_answer(session.chat_id, record.id, record.at);
    await session.mirror_decision?.(record);
    session.emit({ type: "tool_start", call_id });
    return decision;
  },
  side_model: session.side_model,
  review: {
    actor: session.review.actor,
    call: session.review.call,
    history: session.review.history,
    record: async (entry) => {
      session.emit({ type: "tool_review", call_id, review: entry });
      await session.review.mirror?.(entry);
    },
  },
  message_main: session.message_main ?? null,
  send_peer: session.send_peer ?? null,
});

const execute_tool = async (
  session: TurnSession,
  tool: Tool | null,
  call_id: string,
  name: string,
  args: Record<string, unknown> | null,
  profile: ToolProfile,
  image_count: number,
): Promise<ToolOutcome> => {
  if (!tool) {
    const message = `Unknown tool: ${name}`;
    return { aborted: false, status: "failed", result_text: cap_text(message, result_cap_tokens), view: null, error: message, images: [] };
  }
  if (!args) {
    const message = invalid_args_text(name);
    return { aborted: false, status: "failed", result_text: message, view: null, error: message, images: [] };
  }
  try {
    const result = await tool.execute(build_context(session, call_id, profile, image_count), args);
    return {
      aborted: false,
      status: result.status,
      result_text: cap_text(result.text, result_cap_tokens),
      view: result.view,
      error: result.status === "failed" ? result.text.slice(0, 2000) : null,
      images: result.images ?? [],
    };
  } catch (error) {
    if (session.signal.aborted) {
      return { aborted: true, status: "cancelled", result_text: "", view: null, error: null, images: [] };
    }
    const message = error_text(error);
    console.error(`[turn] tool ${name} threw on args ${JSON.stringify(args).slice(0, 200)}:`, error);
    return { aborted: false, status: "failed", result_text: cap_text(message, result_cap_tokens), view: null, error: message, images: [] };
  }
};

const keep_images = async (session: TurnSession, call_id: string, images: ToolImage[]): Promise<KeptImages> => {
  if (!images.length || !session.model.vision) {
    return { stored: [], carried: [], note: "" };
  }
  const carried = images.map((image) => ({ label: image.label, url: image_url(image.bytes, image.mime) }));
  if (!session.store_images) {
    return { stored: [], carried, note: "" };
  }
  try {
    const ids = await session.store_images(images);
    return { stored: images.map((image, at) => ({ id: ids[at], label: image.label })), carried, note: "" };
  } catch (error) {
    console.error(`[turn] storing ${images.length} images of call ${call_id} in chat ${session.chat_id} failed:`, error);
    return { stored: [], carried: [], note: `[The screenshots of this call could not be stored and are not attached: ${error_text(error)}.]` };
  }
};

export const fit_request = async (request: RoundRequest): Promise<boolean> => {
  const limit = image_limit(request.model);
  const bound = reasoning_bound_to_prefix(request.model.id);
  await shrink_images(request.messages, limit, shrunk_data_url, bound);
  return fit_images(request.messages, limit, () => Buffer.byteLength(JSON.stringify(round_body(request))), bound);
};

const aborted_outcome = (result: RoundResult, estimate: number): RoundOutcome => ({
  aborted: true,
  tool_calls: 0,
  finish_reason: result.finish_reason,
  usage: result.usage,
  estimate,
  plan_presented: false,
});

export const round_profile = (session: TurnSession): ToolProfile => session.profile ?? (session.plan ? "plan" : "main");

export const run_round = async (session: TurnSession, round: number, api_messages: ApiMessage[]): Promise<RoundOutcome> => {
  const profile = round_profile(session);
  const tools = session.resolve_tools(profile);
  const request: RoundRequest = { model: session.model, effort: session.effort, messages: api_messages, tools: tools.map((tool) => tool.spec) };
  if (await fit_request(request)) {
    session.emit({ type: "notice", round, notice: "context_trimmed", text: images_left_out_note });
  }
  const estimate = sent_estimate(request.messages, request.tools, session.model);
  const result = await session.stream(
    request,
    {
      on_text: (delta) => session.emit({ type: "text", round, delta }),
      on_reasoning: (delta) => session.emit({ type: "reasoning", round, delta }),
      on_tool_draft: (index, name, draft) => session.emit({ type: "tool_draft", round, index, name, ...draft }),
      on_retry: (attempt, max, reason, wait_ms) => session.emit({ type: "retry", round, attempt, max, reason, wait_ms }),
    },
    session.signal,
  );
  const assistant = assistant_api_message(result);
  api_messages.push(assistant);
  if (result.status === "cancelled" || session.signal.aborted) {
    return aborted_outcome(result, estimate);
  }
  if (result.reasoning_details.length) {
    session.emit({ type: "reasoning_details", round, details: result.reasoning_details });
  }
  if (!result.tool_calls.length) {
    return { aborted: false, tool_calls: 0, finish_reason: result.finish_reason, usage: result.usage, estimate, plan_presented: false };
  }
  const scope = session.call_scope ?? session.message_id;
  const calls: (RoundToolCall & { engine_id: string; args: Record<string, unknown> | null })[] = result.tool_calls.map((call, position) => ({
    ...call,
    engine_id: engine_call_id(round, position),
    args: parse_args(call.arguments),
  }));
  const api_calls: ApiToolCall[] = calls.map((call) => ({
    id: api_call_id(scope, call.engine_id),
    type: "function",
    function: { name: call.name, arguments: call.args && call.arguments.trim() ? call.arguments : "{}" },
  }));
  assistant.tool_calls = api_calls;
  for (const call of calls) {
    session.emit({ type: "tool_call", round, index: call.index, call_id: call.engine_id, name: call.name, args: call.args ?? {} });
  }
  let plan_presented = false;
  const sent_images = image_slots(api_messages).length;
  const carried: CarrierImage[] = [];
  for (const call of calls) {
    if (session.signal.aborted) {
      return aborted_outcome(result, estimate);
    }
    session.emit({ type: "tool_start", call_id: call.engine_id });
    const tool = tools.find((entry) => entry.spec.name === call.name) ?? null;
    const outcome = await execute_tool(session, tool, call.engine_id, call.name, call.args, profile, sent_images + carried.length + 1);
    if (outcome.aborted) {
      return aborted_outcome(result, estimate);
    }
    const kept = await keep_images(session, call.engine_id, outcome.images);
    const result_text = kept.note ? `${outcome.result_text}\n${kept.note}` : outcome.result_text;
    api_messages.push({ role: "tool", tool_call_id: api_call_id(scope, call.engine_id), content: result_text });
    session.emit({
      type: "tool_end",
      call_id: call.engine_id,
      status: outcome.status,
      view: outcome.view,
      error: outcome.error,
      result_text,
      ...(kept.stored.length ? { images: kept.stored } : {}),
    });
    carried.push(...kept.carried);
    if (call.name === "present_plan" && outcome.status === "done") {
      plan_presented = true;
    }
  }
  if (carried.length) {
    api_messages.push(carrier(carried));
  }
  return { aborted: false, tool_calls: calls.length, finish_reason: result.finish_reason, usage: result.usage, estimate, plan_presented };
};
