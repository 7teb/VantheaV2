import type { ToolProgress } from "../../shared/chat.ts";
import type { ToolEndStatus } from "../../shared/events.ts";
import { permission_hash } from "../permissions/context.ts";
import { human_decision } from "../permissions/decisions.ts";
import { error_text } from "../storage/coerce.ts";
import { cap_text } from "../context/estimate.ts";
import type { ToolView } from "../../shared/tool-view.ts";
import type { ApiAssistantMessage, ApiMessage, ApiToolCall, RoundResult, RoundToolCall, RoundUsage } from "../model/types.ts";
import type { Tool, ToolContext, ToolProfile } from "../tools/types.ts";
import type { Emitter, TurnSession } from "./session.ts";

export type RoundOutcome = {
  aborted: boolean;
  tool_calls: number;
  finish_reason: string;
  usage: RoundUsage | null;
  plan_presented: boolean;
};

const result_cap_tokens = 25000;

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
  return (progress) => {
    const now = Date.now();
    if (now - last < progress_interval_ms) {
      return;
    }
    last = now;
    emit({ type: "tool_progress", call_id, progress });
  };
};

type ToolOutcome = { aborted: boolean; status: ToolEndStatus; result_text: string; view: ToolView | null; error: string | null };

const build_context = (session: TurnSession, call_id: string, profile: ToolProfile): ToolContext => ({
  chat_id: session.chat_id,
  turn_id: session.message_id,
  call_id,
  project_root: session.project_root,
  user_request: session.user_request,
  authorization: session.authorization,
  human_decisions: session.human_decisions,
  get delegated_task() { return session.delegated_task; },
  mode: session.mode,
  profile,
  settings: session.settings,
  signal: session.signal,
  progress: throttled_progress(session.emit, call_id),
  approve: async (request) => {
    session.emit({ type: "tool_approval", call_id, request });
    const decision = await session.wait_decision(call_id);
    session.signal.throwIfAborted();
    const record = human_decision(request, decision, session.actor ?? "main", permission_hash(session.authorization?.() ?? session.user_request));
    session.emit({ type: "tool_decision", call_id, decision: record });
    await session.mirror_decision?.(record);
    session.emit({ type: "tool_start", call_id });
    return decision;
  },
  side_model: session.side_model,
  message_main: session.message_main ?? null,
});

const execute_tool = async (
  session: TurnSession,
  tool: Tool | null,
  call_id: string,
  name: string,
  args: Record<string, unknown> | null,
  profile: ToolProfile,
): Promise<ToolOutcome> => {
  if (!tool) {
    const message = `Unknown tool: ${name}`;
    return { aborted: false, status: "failed", result_text: cap_text(message, result_cap_tokens), view: null, error: message };
  }
  if (!args) {
    const message = invalid_args_text(name);
    return { aborted: false, status: "failed", result_text: message, view: null, error: message };
  }
  try {
    const result = await tool.execute(build_context(session, call_id, profile), args);
    return {
      aborted: false,
      status: result.status,
      result_text: cap_text(result.text, result_cap_tokens),
      view: result.view,
      error: result.status === "failed" ? result.text.slice(0, 2000) : null,
    };
  } catch (error) {
    if (session.signal.aborted) {
      return { aborted: true, status: "cancelled", result_text: "", view: null, error: null };
    }
    const message = error_text(error);
    console.error(`[turn] tool ${name} threw on args ${JSON.stringify(args).slice(0, 200)}:`, error);
    return { aborted: false, status: "failed", result_text: cap_text(message, result_cap_tokens), view: null, error: message };
  }
};

const aborted_outcome = (result: RoundResult): RoundOutcome => ({
  aborted: true,
  tool_calls: 0,
  finish_reason: result.finish_reason,
  usage: result.usage,
  plan_presented: false,
});

export const run_round = async (session: TurnSession, round: number, api_messages: ApiMessage[], offer_tools = true): Promise<RoundOutcome> => {
  const profile = session.profile ?? (session.plan ? "plan" : "main");
  const tools = offer_tools ? session.resolve_tools(profile) : [];
  const result = await session.stream(
    { model: session.model, effort: session.effort, messages: api_messages, tools: tools.map((tool) => tool.spec) },
    {
      on_text: (delta) => session.emit({ type: "text", round, delta }),
      on_reasoning: (delta) => session.emit({ type: "reasoning", round, delta }),
      on_tool_draft: (index, name, lines) => session.emit({ type: "tool_draft", round, index, name, lines }),
      on_retry: (attempt, max, reason, wait_ms) => session.emit({ type: "retry", round, attempt, max, reason, wait_ms }),
    },
    session.signal,
  );
  const assistant = assistant_api_message(result);
  api_messages.push(assistant);
  if (result.status === "cancelled" || session.signal.aborted) {
    return aborted_outcome(result);
  }
  if (result.reasoning_details.length) {
    session.emit({ type: "reasoning_details", round, details: result.reasoning_details });
  }
  if (!result.tool_calls.length) {
    return { aborted: false, tool_calls: 0, finish_reason: result.finish_reason, usage: result.usage, plan_presented: false };
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
  for (const call of calls) {
    if (session.signal.aborted) {
      return aborted_outcome(result);
    }
    session.emit({ type: "tool_start", call_id: call.engine_id });
    const tool = tools.find((entry) => entry.spec.name === call.name) ?? null;
    const outcome = await execute_tool(session, tool, call.engine_id, call.name, call.args, profile);
    if (outcome.aborted) {
      return aborted_outcome(result);
    }
    api_messages.push({ role: "tool", tool_call_id: api_call_id(scope, call.engine_id), content: outcome.result_text });
    session.emit({ type: "tool_end", call_id: call.engine_id, status: outcome.status, view: outcome.view, error: outcome.error, result_text: outcome.result_text });
    if (call.name === "present_plan" && outcome.status === "done") {
      plan_presented = true;
    }
  }
  return { aborted: false, tool_calls: calls.length, finish_reason: result.finish_reason, usage: result.usage, plan_presented };
};
