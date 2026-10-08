import type { ApprovalDecision, GrantScope } from "../../shared/approval.ts";
import type { AssistantMessage, Attachment, ContextUsage, PermissionMode, UserOrigin } from "../../shared/chat.ts";
import type { CompactResult, SendRequest } from "../../shared/ipc/chats.ts";
import { get_chat, set_summary } from "../chats/store.ts";
import { compact_chat, plan_compaction, render_turns } from "../context/compact.ts";
import { estimate_tokens } from "../context/estimate.ts";
import { find_model } from "../model/catalog.ts";
import { model_catalog } from "../model/catalog-file.ts";
import { resolve_decision } from "../permissions/approvals.ts";
import { close_full_window, full_window_until, on_full_window } from "../permissions/full-window.ts";
import { get_settings } from "../settings/store.ts";
import { side_model } from "../side/model.ts";
import { as_array, as_number, as_string, pick, require_record, require_string } from "../storage/coerce.ts";
import { is_active } from "../turn/active.ts";
import { accept_plan, continue_turn, edit_turn, start_turn, steer_turn, stop_turn } from "../turn/run.ts";
import { emit, handle } from "./handle.ts";

const modes: readonly PermissionMode[] = ["ask", "auto", "full"];

const origins: readonly UserOrigin[] = ["user", "plan_accept", "continue", "background", "agent_report"];

const grants: readonly GrantScope[] = ["once", "prefix", "chat", "session", "full_window"];

const chat_id_of = (value: unknown) => require_string(value, "chat id", 200);

const attachment_kinds: readonly Attachment["kind"][] = ["image", "file"];

const parse_attachment = (value: unknown): Attachment => {
  const raw = require_record(value, "attachment");
  return {
    id: require_string(raw.id, "attachment id", 300),
    kind: pick(raw.kind, attachment_kinds, "file"),
    name: as_string(raw.name).slice(0, 300),
    mime: as_string(raw.mime).slice(0, 200),
    size: Math.max(0, Math.floor(as_number(raw.size, 0))),
    vision_note: typeof raw.vision_note === "string" ? raw.vision_note : null,
  };
};

const parse_send = (value: unknown): SendRequest => {
  const raw = require_record(value, "send request");
  return {
    chat_id: chat_id_of(raw.chat_id),
    text: require_string(raw.text, "message text", 200_000),
    attachments: as_array(raw.attachments).slice(0, 50).map(parse_attachment),
    model: require_string(raw.model, "model id", 300),
    effort: as_string(raw.effort).slice(0, 40),
    mode: pick(raw.mode, modes, "ask"),
    plan: raw.plan === true,
    origin: pick(raw.origin, origins, "user"),
  };
};

export const parse_decision = (value: unknown): ApprovalDecision => {
  const raw = require_record(value, "approval decision");
  return { approved: raw.approved === true, grant: pick(raw.grant, grants, "once"), feedback: as_string(raw.feedback).slice(0, 4000) };
};

const resolve_model = async (model_id: string) => {
  const catalog = await model_catalog();
  return find_model(catalog, model_id) ?? catalog.models[0];
};

const current_context = async (chat_id: string): Promise<ContextUsage> => {
  const chat = await get_chat(chat_id);
  if (!chat) {
    throw new Error(`chat ${chat_id} not found`);
  }
  const last = [...chat.messages].reverse().find((message): message is AssistantMessage => message.role === "assistant");
  const model = await resolve_model(last?.model ?? get_settings().model);
  const summary_at = chat.summary ? chat.messages.findIndex((message) => message.id === chat.summary?.through_message_id) : -1;
  const measured_at = last ? chat.messages.indexOf(last) : -1;
  if (last?.context && summary_at < measured_at) {
    return last.context;
  }
  const visible = summary_at >= 0 ? chat.messages.slice(summary_at + 1) : chat.messages;
  const used = estimate_tokens(render_turns(visible)) + estimate_tokens(chat.summary?.text ?? "");
  return { used, limit: model.context_length };
};

const force_compact = async (chat_id: string): Promise<CompactResult> => {
  if (is_active(chat_id)) {
    return { status: "busy" };
  }
  const chat = await get_chat(chat_id);
  if (!chat) {
    throw new Error(`chat ${chat_id} not found`);
  }
  if (!plan_compaction(chat.messages)) {
    return { status: "nothing" };
  }
  const summary = await compact_chat({
    chat_id,
    messages: chat.messages,
    summary: chat.summary,
    round: 0,
    emit: () => undefined,
    side_model,
    set_summary,
    signal: AbortSignal.timeout(60000),
  });
  return { status: summary ? "done" : "failed" };
};

export const register_turn_ipc = () => {
  on_full_window((chat_id, until) => emit("turn:full_window_changed", { chat_id, until }));
  handle("turn:send", (request) => {
    const parsed = parse_send(request);
    return start_turn(parsed, parsed.origin);
  });
  handle("turn:edit", (chat_id, message_id, text) =>
    edit_turn(chat_id_of(chat_id), require_string(message_id, "message id", 200), require_string(text, "message text", 200_000)),
  );
  handle("turn:continue", (chat_id) => continue_turn(chat_id_of(chat_id)));
  handle("turn:accept_plan", (chat_id, message_id) => accept_plan(chat_id_of(chat_id), require_string(message_id, "message id", 200)));
  handle("turn:stop", (chat_id) => stop_turn(chat_id_of(chat_id)));
  handle("turn:steer", (chat_id, text, attachments, steer_id) =>
    steer_turn(
      chat_id_of(chat_id),
      require_string(text, "steer text", 200_000),
      as_array(attachments).slice(0, 50).map(parse_attachment),
      require_string(steer_id, "steer id", 200),
    ),
  );
  handle("turn:approve", (chat_id, call_id, decision) => {
    resolve_decision(chat_id_of(chat_id), require_string(call_id, "call id", 200), parse_decision(decision));
  });
  handle("turn:full_window", (chat_id) => {
    const id = chat_id_of(chat_id);
    return { chat_id: id, until: full_window_until(id) };
  });
  handle("turn:end_full_window", (chat_id) => close_full_window(chat_id_of(chat_id)));
  handle("turn:context", (chat_id) => current_context(chat_id_of(chat_id)));
  handle("turn:compact", (chat_id) => force_compact(chat_id_of(chat_id)));
};
