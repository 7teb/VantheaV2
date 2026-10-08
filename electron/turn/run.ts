import { randomUUID } from "node:crypto";
import type { AssistantMessage, Attachment, Message, UserMessage } from "../../shared/chat.ts";
import type { SendRequest, TurnStarted } from "../../shared/ipc/chats.ts";
import type { UserOrigin } from "../../shared/chat.ts";
import type { ModelEntry } from "../../shared/models.ts";
import { major_wait_ms, take_agent_notes, wait_for_input, wake_idle } from "../agents/reports.ts";
import { compact_chat, needs_compaction } from "../context/compact.ts";
import { estimate_request } from "../context/usage.ts";
import { append_message, flush_chat, get_chat, set_streaming, set_summary, truncate_after, update_message } from "../chats/store.ts";
import { chat_root } from "../chats/workspace.ts";
import { emit } from "../ipc/handle.ts";
import { find_model, major_effort, resolve_effort } from "../model/catalog.ts";
import { model_catalog } from "../model/catalog-file.ts";
import { stream_round } from "../model/stream.ts";
import { cancel_chat, wait_for_decision } from "../permissions/approvals.ts";
import { authorization_text, set_authorization } from "../permissions/context.ts";
import { chat_decisions } from "../permissions/decisions.ts";
import { build_system_prompt } from "../prompts/index.ts";
import { get_settings } from "../settings/store.ts";
import { error_text } from "../storage/coerce.ts";
import { mcp_tools } from "../tools/mcp/tools.ts";
import { tools_for } from "../tools/registry.ts";
import { side_model } from "../side/model.ts";
import { describe_attachment_with_timeout } from "../side/vision.ts";
import { start_title } from "../side/title.ts";
import {
  abort_turn,
  active_assistant_reference,
  active_turn,
  active_turns,
  clear_active,
  is_active,
  push_steer,
  register_active,
  release_chat,
  reserve_chat,
  take_steers_active,
  unregister_active,
} from "./active.ts";
import { create_emitter, type EmitDeps } from "./emit.ts";
import { build_api_messages } from "./history.ts";
import { run_turn_loop } from "./loop.ts";
import type { TurnSession } from "./session.ts";

const app_closed_message = "The app was closed while this turn was still running.";

let turn_finished: ((chat_id: string, message_id: string) => void) | null = null;

export const set_turn_finished_hook = (fn: (chat_id: string, message_id: string) => void): void => {
  turn_finished = fn;
};

const run_finished_hook = (chat_id: string, message_id: string) => {
  try {
    turn_finished?.(chat_id, message_id);
  } catch (error) {
    console.error(`[turn] turn-finished hook for chat ${chat_id} failed:`, error);
  }
};

const emit_deps: EmitDeps = {
  update_message,
  forward: (event) => emit("turn:event", event),
  flush: (chat_id) => {
    void flush_chat(chat_id);
  },
};

const iso = () => new Date().toISOString();

const ensure_vision_notes = async (attachments: Attachment[], model: ModelEntry): Promise<Attachment[]> => {
  if (model.vision) {
    return attachments;
  }
  const out: Attachment[] = [];
  for (const attachment of attachments) {
    if (attachment.kind !== "image" || attachment.vision_note) {
      out.push(attachment);
      continue;
    }
    try {
      out.push({ ...attachment, vision_note: await describe_attachment_with_timeout(attachment.id, "") });
    } catch (error) {
      console.error(`[turn] computing a vision note for attachment ${attachment.id} failed:`, error);
      out.push(attachment);
    }
  }
  return out;
};

type TurnPlan = {
  chat_id: string;
  message_id: string;
  model: ModelEntry;
  effort: string;
  mode: SendRequest["mode"];
  plan: boolean;
  user_request: string;
  project_root: string;
};

const drive = async (plan: TurnPlan, turn: ReturnType<typeof register_active>): Promise<void> => {
  const signal = turn.controller.signal;
  try {
    const loaded = await get_chat(plan.chat_id);
    if (!loaded) {
      throw new Error(`chat ${plan.chat_id} is no longer available`);
    }
    const settings = get_settings();
    const history = loaded.messages.filter((message) => message.id !== plan.message_id);
    set_authorization(plan.chat_id, history, turn.steers);
    const profile = plan.plan ? "plan" : "main";
    const offered = tools_for(profile, settings, mcp_tools());
    const has_file_attachments = history.some((message) => message.role === "user" && message.attachments.some((entry) => entry.kind === "file"));
    const system = await build_system_prompt({
      model: plan.model,
      settings,
      mode: plan.mode,
      plan: plan.plan,
      personality: settings.personality,
      project_root: plan.project_root,
      chat_id: plan.chat_id,
      user_text: plan.user_request,
      tools: offered,
      has_file_attachments,
      effort: plan.effort,
    });
    const history_input = { system, summary: loaded.summary, messages: history, model: plan.model };
    let api_messages = await build_api_messages(history_input);
    if (needs_compaction(estimate_request(api_messages, offered.map((tool) => tool.spec)), plan.model)) {
      const summary = await compact_chat({
        chat_id: plan.chat_id,
        messages: history,
        summary: loaded.summary,
        round: 0,
        emit: turn.emit,
        side_model,
        set_summary,
        signal,
      });
      if (summary) {
        api_messages = await build_api_messages({ ...history_input, summary });
      }
    }
    const session: TurnSession = {
      chat_id: plan.chat_id,
      message_id: plan.message_id,
      user_request: plan.user_request,
      authorization: () => authorization_text(plan.chat_id, get_settings().custom_instructions),
      project_root: plan.project_root,
      settings,
      model: plan.model,
      effort: plan.effort,
      mode: plan.mode,
      plan: plan.plan,
      signal,
      emit: turn.emit,
      stream: stream_round,
      resolve_tools: (p) => tools_for(p, settings, mcp_tools()),
      side_model,
      wait_decision: (call_id) => wait_for_decision(plan.chat_id, call_id, signal),
      actor: "main",
      human_decisions: () => chat_decisions(plan.chat_id),
      take_steers: () => take_steers_active(plan.chat_id),
      take_notes: () => take_agent_notes(plan.chat_id),
      idle: () => wait_for_input(plan.chat_id, plan.effort === major_effort ? major_wait_ms : 0, signal),
    };
    await run_turn_loop(session, api_messages);
  } catch (error) {
    console.error(`[turn] turn ${plan.message_id} in chat ${plan.chat_id} failed to run:`, error);
    turn.emit({ type: "end", status: "failed", error: { kind: "internal", message: error_text(error) } });
  } finally {
    set_streaming(plan.chat_id, false);
    unregister_active(plan.chat_id, plan.message_id);
    cancel_chat(plan.chat_id);
    await flush_chat(plan.chat_id);
    run_finished_hook(plan.chat_id, plan.message_id);
  }
};

type Trigger = { kind: "new"; text: string; attachments: Attachment[] } | { kind: "existing"; message_id: string; text: string };

type BeginInput = { chat_id: string; model_id: string; effort: string; mode: SendRequest["mode"]; plan: boolean; origin: UserOrigin; trigger: Trigger };

const with_reservation = async <T>(chat_id: string, work: () => Promise<T>): Promise<T> => {
  if (!reserve_chat(chat_id)) {
    throw new Error(`chat ${chat_id} already has a running turn`);
  }
  try {
    return await work();
  } finally {
    release_chat(chat_id);
  }
};

const launch = async (input: BeginInput): Promise<TurnStarted> => {
  const chat = await get_chat(input.chat_id);
  if (!chat) {
    throw new Error(`chat ${input.chat_id} not found`);
  }
  if (chat.streaming) {
    throw new Error(`chat ${input.chat_id} is already streaming`);
  }
  const catalog = await model_catalog();
  const model = find_model(catalog, input.model_id);
  if (!model) {
    throw new Error(`model ${input.model_id} is not in the catalog`);
  }
  const effort = resolve_effort(model, input.effort);
  const project_root = await chat_root(chat);
  let user_message_id: string;
  let user_request: string;
  if (input.trigger.kind === "new") {
    const first_user = !chat.messages.some((message) => message.role === "user");
    const attachments = await ensure_vision_notes(input.trigger.attachments, model);
    const user: UserMessage = { id: randomUUID(), role: "user", text: input.trigger.text, attachments, origin: input.origin, created_at: iso() };
    await append_message(input.chat_id, user);
    user_message_id = user.id;
    user_request = input.trigger.text;
    if (first_user) {
      start_title(input.chat_id, input.trigger.text);
    }
  } else {
    user_message_id = input.trigger.message_id;
    user_request = input.trigger.text;
  }
  const message_id = randomUUID();
  const placeholder: AssistantMessage = {
    id: message_id,
    role: "assistant",
    model: model.id,
    effort,
    mode: input.mode,
    plan: input.plan,
    created_at: iso(),
    ended_at: null,
    status: "streaming",
    steps: [],
    reasoning_details: [],
    retry: null,
    error: null,
    context: null,
    last_seq: 0,
  };
  await append_message(input.chat_id, placeholder);
  set_streaming(input.chat_id, true);
  const turn = register_active(input.chat_id, message_id, create_emitter(input.chat_id, message_id, emit_deps), model, effort);
  const turn_plan: TurnPlan = { chat_id: input.chat_id, message_id, model, effort, mode: input.mode, plan: input.plan, user_request, project_root };
  setImmediate(() => {
    void drive(turn_plan, turn);
  });
  return { user_message_id, message_id };
};

const begin = (input: BeginInput): Promise<TurnStarted> => with_reservation(input.chat_id, () => launch(input));

export const start_turn = (request: SendRequest, origin: UserOrigin): Promise<TurnStarted> =>
  begin({
    chat_id: request.chat_id,
    model_id: request.model,
    effort: request.effort,
    mode: request.mode,
    plan: request.plan,
    origin,
    trigger: { kind: "new", text: request.text, attachments: request.attachments },
  });

export const start_internal_turn = async (chat_id: string, origin: UserOrigin, text: string): Promise<TurnStarted | null> => {
  if (is_active(chat_id)) {
    return null;
  }
  const settings = get_settings();
  try {
    return await begin({
      chat_id,
      model_id: settings.model,
      effort: settings.effort,
      mode: settings.mode,
      plan: false,
      origin,
      trigger: { kind: "new", text, attachments: [] },
    });
  } catch (error) {
    console.error(`[turn] internal turn for chat ${chat_id} did not start:`, error);
    return null;
  }
};

const settings_request = () => {
  const settings = get_settings();
  return { model_id: settings.model, effort: settings.effort, mode: settings.mode };
};

export const edit_turn = (chat_id: string, message_id: string, text: string): Promise<TurnStarted> =>
  with_reservation(chat_id, async () => {
    const chat = await get_chat(chat_id);
    if (!chat) {
      throw new Error(`chat ${chat_id} not found`);
    }
    if (chat.streaming) {
      throw new Error(`chat ${chat_id} is already streaming`);
    }
    const at = chat.messages.findIndex((message) => message.id === message_id);
    const target = chat.messages[at];
    if (at < 0 || target?.role !== "user") {
      throw new Error(`message ${message_id} is not an editable user message in chat ${chat_id}`);
    }
    const { model_id, effort, mode } = settings_request();
    const prior = chat.messages[at - 1];
    if (prior) {
      await truncate_after(chat_id, prior.id);
      return launch({ chat_id, model_id, effort, mode, plan: false, origin: "user", trigger: { kind: "new", text, attachments: target.attachments } });
    }
    await truncate_after(chat_id, message_id);
    const edited: UserMessage = { ...target, text };
    update_message(chat_id, message_id, () => edited);
    emit("chats:message_replaced", { chat_id, message: edited });
    return launch({ chat_id, model_id, effort, mode, plan: false, origin: "user", trigger: { kind: "existing", message_id, text } });
  });

export const continue_turn = (chat_id: string): Promise<TurnStarted> => {
  const { model_id, effort, mode } = settings_request();
  return begin({ chat_id, model_id, effort, mode, plan: false, origin: "continue", trigger: { kind: "new", text: "Continue.", attachments: [] } });
};

const plan_text_of = (message: Message | undefined): string => {
  if (!message || message.role !== "assistant") {
    return "";
  }
  const step = message.steps.find((entry) => entry.kind === "tool" && entry.name === "present_plan");
  return step && step.kind === "tool" && step.view?.kind === "plan" ? step.view.text : "";
};

export const accept_plan = async (chat_id: string, message_id: string): Promise<TurnStarted> => {
  const chat = await get_chat(chat_id);
  if (!chat) {
    throw new Error(`chat ${chat_id} not found`);
  }
  const plan = plan_text_of(chat.messages.find((message) => message.id === message_id));
  const text = plan ? `Here is the plan you presented:\n\n${plan}\n\nImplement this plan now. Write the files and make the changes.` : "Implement the plan you presented now. Write the files and make the changes.";
  const { model_id, effort, mode } = settings_request();
  return begin({ chat_id, model_id, effort, mode, plan: false, origin: "plan_accept", trigger: { kind: "new", text, attachments: [] } });
};

export const stop_turn = (chat_id: string): void => {
  abort_turn(chat_id, new Error("the user stopped the turn"));
  cancel_chat(chat_id);
};

export const steer_turn = async (chat_id: string, text: string, attachments: Attachment[], steer_id: string): Promise<string | null> => {
  const turn = active_turn(chat_id);
  if (!turn) {
    return null;
  }
  const assistant_reference = active_assistant_reference(chat_id);
  const noted = await ensure_vision_notes(attachments, turn.model);
  if (active_turn(chat_id) !== turn || !push_steer(chat_id, text, steer_id, noted, assistant_reference)) {
    return null;
  }
  wake_idle(chat_id);
  return turn.message_id;
};

export const interrupt_all_turns = (): void => {
  for (const [chat_id, turn] of active_turns()) {
    turn.controller.abort(new Error(app_closed_message));
    turn.emit({ type: "end", status: "interrupted", error: { kind: "app_closed", message: app_closed_message } });
    set_streaming(chat_id, false);
    cancel_chat(chat_id);
  }
  clear_active();
};
