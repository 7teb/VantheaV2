import type { ApprovalDecision, GrantScope } from "../../shared/approval.ts";
import type { AssistantMessage, ContextUsage, PermissionMode, UserOrigin } from "../../shared/chat.ts";
import type { SendRequest } from "../../shared/ipc/chats.ts";
import { get_chat } from "../chats/store.ts";
import { estimate_messages } from "../context/usage.ts";
import { uploaded } from "../media/uploads.ts";
import { find_model } from "../model/catalog.ts";
import { model_catalog } from "../model/catalog-file.ts";
import { open_chat_window, resolve_decision } from "../permissions/approvals.ts";
import { close_full_window, full_window_until, on_full_window } from "../permissions/full-window.ts";
import { context_model } from "../settings/model-context.ts";
import { get_settings } from "../settings/store.ts";
import { as_string, pick, require_record, require_string } from "../storage/coerce.ts";
import { build_api_messages } from "../turn/history.ts";
import { accept_plan, compact_turn, continue_turn, edit_turn, start_turn, steer_turn, stop_turn } from "../turn/run.ts";
import { counted_image } from "../turn/user-input.ts";
import { emit, handle } from "./handle.ts";
import { parse_ids } from "./media.ts";

const modes: readonly PermissionMode[] = ["ask", "auto", "full"];

const origins: readonly UserOrigin[] = ["user", "plan_accept", "continue"];

const grants: readonly GrantScope[] = ["once", "prefix", "chat", "session"];

const chat_id_of = (value: unknown) => require_string(value, "chat id", 200);

const parse_send = (value: unknown): SendRequest => {
  const raw = require_record(value, "send request");
  return {
    chat_id: chat_id_of(raw.chat_id),
    text: require_string(raw.text, "message text", 200_000),
    attachment_ids: parse_ids(raw.attachment_ids),
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
  return context_model(find_model(catalog, model_id) ?? catalog.models[0]);
};

const current_context = async (chat_id: string): Promise<ContextUsage> => {
  const chat = await get_chat(chat_id);
  if (!chat) {
    throw new Error(`chat ${chat_id} not found`);
  }
  const measured = chat.messages.findLast((message): message is AssistantMessage => message.role === "assistant" && message.context !== null);
  if (measured?.context) {
    return measured.context;
  }
  const last = chat.messages.findLast((message): message is AssistantMessage => message.role === "assistant");
  const model = await resolve_model(last?.model ?? get_settings().model);
  const messages = await build_api_messages({ system: "", summary: chat.summary, messages: chat.messages, model, agent_tools: true }, counted_image);
  return { used: estimate_messages(messages), limit: model.context_length };
};

export const register_turn_ipc = () => {
  on_full_window((chat_id, until) => emit("turn:full_window_changed", { chat_id, until }));
  handle("turn:send", (request) => {
    const parsed = parse_send(request);
    return start_turn(parsed, uploaded(parsed.attachment_ids), parsed.origin);
  });
  handle("turn:edit", (chat_id, message_id, text) =>
    edit_turn(chat_id_of(chat_id), require_string(message_id, "message id", 200), require_string(text, "message text", 200_000)),
  );
  handle("turn:continue", (chat_id) => continue_turn(chat_id_of(chat_id)));
  handle("turn:accept_plan", (chat_id, message_id) => accept_plan(chat_id_of(chat_id), require_string(message_id, "message id", 200)));
  handle("turn:stop", (chat_id) => stop_turn(chat_id_of(chat_id)));
  handle("turn:steer", (chat_id, text, attachment_ids, steer_id) =>
    steer_turn(
      chat_id_of(chat_id),
      require_string(text, "steer text", 200_000),
      uploaded(parse_ids(attachment_ids)),
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
  handle("turn:open_full_window", (chat_id) => open_chat_window(chat_id_of(chat_id)));
  handle("turn:end_full_window", (chat_id) => close_full_window(chat_id_of(chat_id)));
  handle("turn:context", (chat_id) => current_context(chat_id_of(chat_id)));
  handle("turn:compact", (chat_id) => compact_turn(chat_id_of(chat_id)));
};
