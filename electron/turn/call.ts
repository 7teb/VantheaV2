import { randomUUID } from "node:crypto";
import { approval_skip_ms, skips_unanswered } from "../../shared/approval.ts";
import type { StepImage, ToolProgress } from "../../shared/chat.ts";
import type { ToolEndStatus } from "../../shared/events.ts";
import type { ToolFailure } from "../../shared/tool-failure.ts";
import type { ToolView } from "../../shared/tool-view.ts";
import { last_human_id, note_human_answer } from "../permissions/context.ts";
import { human_decision } from "../permissions/decisions.ts";
import { error_text } from "../storage/coerce.ts";
import { cap_text, result_cap_tokens } from "../context/estimate.ts";
import { image_rules } from "../model/image-limits.ts";
import type { RoundToolCall } from "../model/types.ts";
import { failure_of, type ContextReading, type Tool, type ToolContext, type ToolImage, type ToolProfile } from "../tools/types.ts";
import { image_url, type CarrierImage } from "./carriers.ts";
import type { HookCall } from "../hooks/input.ts";
import type { PostToolGate } from "../hooks/turn-hooks.ts";
import type { Emitter, TurnSession } from "./session.ts";

const progress_interval_ms = 100;

export const engine_call_id = (round: number, index: number) => `c${round}_${index}`;

export const api_call_id = (scope: string, call_id: string) => `call_${scope.replace(/[^A-Za-z0-9]/g, "").slice(-8)}_${call_id}`;

export const parse_args = (raw: string): Record<string, unknown> | null => {
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

const removed_tool_text = (name: string) =>
  `${name} was removed from your tools by the main agent, so the call did not run. Continue without it; if the task cannot be done without it, report that as a blocker.`;

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

type ToolOutcome = { aborted: boolean; status: ToolEndStatus; result_text: string; view: ToolView | null; error: string | null; failure?: ToolFailure; images: ToolImage[] };

type KeptImages = { stored: StepImage[]; carried: CarrierImage[]; note: string };

export type EngineCall = RoundToolCall & { engine_id: string; args: Record<string, unknown> | null; tool: Tool | null };

export type CallResult = { aborted: true } | { aborted: false; status: ToolEndStatus; result_text: string; carried: CarrierImage[]; plan: boolean };

const build_context = (session: TurnSession, call_id: string, profile: ToolProfile, image_count: number, context: () => ContextReading): ToolContext => ({
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
    const pending = {
      ...request,
      request_id: randomUUID(),
      ...(skips_unanswered(request) ? { expires_at: Date.now() + approval_skip_ms } : {}),
    };
    session.emit({ type: "tool_approval", call_id, request: pending });
    const decision = await session.wait_decision(
      call_id,
      pending,
      (held) => session.emit({ type: "tool_approval", call_id, request: held }),
      session.signal,
    );
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
    model: session.review.model,
    call: session.review.call,
    history: session.review.history,
    record: async (entry) => {
      session.emit({ type: "tool_review", call_id, review: entry });
      await session.review.mirror?.(entry);
    },
  },
  message_main: session.message_main ?? null,
  send_peer: session.send_peer ?? null,
  context,
});

const execute_tool = async (
  session: TurnSession,
  tool: Tool | null,
  call_id: string,
  name: string,
  args: Record<string, unknown> | null,
  profile: ToolProfile,
  image_count: number,
  context: () => ContextReading,
): Promise<ToolOutcome> => {
  if (!tool) {
    const message = session.without_tools?.includes(name) ? removed_tool_text(name) : `Unknown tool: ${name}`;
    return { aborted: false, status: "failed", result_text: cap_text(message, result_cap_tokens), view: null, error: message, images: [] };
  }
  if (!args) {
    const message = invalid_args_text(name);
    return { aborted: false, status: "failed", result_text: message, view: null, error: message, images: [] };
  }
  try {
    const result = await tool.execute(build_context(session, call_id, profile, image_count, context), args);
    return {
      aborted: false,
      status: result.status,
      result_text: cap_text(result.text, result_cap_tokens),
      view: result.view,
      error: result.status === "failed" ? result.text.slice(0, 2000) : null,
      ...(result.status === "failed" && result.failure ? { failure: result.failure } : {}),
      images: result.images ?? [],
    };
  } catch (error) {
    if (session.signal.aborted) {
      return { aborted: true, status: "cancelled", result_text: "", view: null, error: null, images: [] };
    }
    const message = error_text(error);
    console.error(`[turn] tool ${name} threw on args ${JSON.stringify(args).slice(0, 200)}:`, error);
    const failure = failure_of(error);
    return { aborted: false, status: "failed", result_text: cap_text(message, result_cap_tokens), view: null, error: message, ...(failure ? { failure } : {}), images: [] };
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

const hook_call = (session: TurnSession, call: EngineCall): HookCall | null =>
  session.hooks && call.tool && call.args ? { name: call.name, args: call.args, tool_use_id: api_call_id(session.call_scope ?? session.message_id, call.engine_id) } : null;

const after_hooks = (session: TurnSession, hooked: HookCall | null, outcome: ToolOutcome, duration_ms: number): Promise<PostToolGate> | null =>
  hooked && session.hooks && (outcome.status === "done" || outcome.status === "failed")
    ? session.hooks.post_tool(hooked, { status: outcome.status, text: outcome.result_text, view: outcome.view, duration_ms })
    : null;

export const run_call = async (session: TurnSession, call: EngineCall, profile: ToolProfile, image_count: number, context: () => ContextReading): Promise<CallResult> => {
  session.emit({ type: "tool_start", call_id: call.engine_id });
  const hooked = hook_call(session, call);
  const pre = hooked && session.hooks ? await session.hooks.pre_tool(hooked) : null;
  if (pre?.kind === "aborted") {
    return { aborted: true };
  }
  if (pre?.kind === "blocked") {
    session.emit({ type: "tool_end", call_id: call.engine_id, status: "denied", view: null, error: null, result_text: pre.text, hooks: pre.runs });
    return { aborted: false, status: "denied", result_text: pre.text, carried: [], plan: false };
  }
  const started = Date.now();
  const outcome = await execute_tool(session, call.tool, call.engine_id, call.name, call.args, profile, image_count, context);
  if (outcome.aborted) {
    return { aborted: true };
  }
  const post = await after_hooks(session, hooked, outcome, Date.now() - started);
  const finished = post?.kind === "done" ? post : null;
  const runs = [...(pre?.runs ?? []), ...(finished?.runs ?? [])];
  const tool_text = finished?.result_text ?? outcome.result_text;
  const kept = await keep_images(session, call.engine_id, outcome.images);
  const result_text = kept.note ? `${tool_text}\n${kept.note}` : tool_text;
  session.emit({
    type: "tool_end",
    call_id: call.engine_id,
    status: outcome.status,
    view: outcome.view,
    error: outcome.error,
    ...(outcome.failure ? { failure: outcome.failure } : {}),
    result_text,
    ...(kept.stored.length ? { images: kept.stored } : {}),
    ...(runs.length ? { hooks: runs } : {}),
  });
  if (post?.kind === "aborted") {
    return { aborted: true };
  }
  return { aborted: false, status: outcome.status, result_text, carried: kept.carried, plan: call.name === "present_plan" && outcome.status === "done" };
};
