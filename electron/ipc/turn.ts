import type { ApprovalDecision, GrantScope } from "../../shared/approval.ts";
import { command_origins, type AssistantMessage, type CommandOrigin, type ContextUsage, type PermissionMode, type UserOrigin } from "../../shared/chat.ts";
import type { SendRequest } from "../../shared/ipc/chats.ts";
import { model_listing, speed_tiers, with_pro } from "../../shared/models.ts";
import { get_chat } from "../chats/store.ts";
import { estimate_messages } from "../context/usage.ts";
import { uploaded } from "../media/uploads.ts";
import { model_catalog } from "../model/catalog-file.ts";
import { hold_decision, open_chat_window, resolve_decision } from "../permissions/approvals.ts";
import { close_full_window, full_window_until, on_full_window } from "../permissions/full-window.ts";
import { context_model } from "../settings/model-context.ts";
import { get_settings } from "../settings/store.ts";
import { hold_events_for } from "../app/notifications.ts";
import { as_array, as_string, pick, require_record, require_string } from "../storage/coerce.ts";
import { build_api_messages } from "../turn/history.ts";
import { accept_plan, compact_turn, continue_turn, edit_turn, init_turn, start_turn, steer_turn, stop_turn, undo_turn } from "../turn/run.ts";
import { counted_image } from "../turn/user-input.ts";
import { emit, handle, handle_client } from "./handle.ts";
import { parse_ids } from "./media.ts";

const modes: readonly PermissionMode[] = ["ask", "auto", "full"];

const origins: readonly UserOrigin[] = ["user", "plan_accept", "continue"];

const grants: readonly GrantScope[] = ["once", "prefix", "chat", "session"];

const chat_id_of = (value: unknown) => require_string(value, "chat id", 200);

const command_of = (value: unknown): CommandOrigin => {
  const command = command_origins.find((entry) => entry === value);
  if (!command) {
    throw new Error(`unknown command turn ${String(value).slice(0, 40)}`);
  }
  return command;
};

const pull_request_number = /^[1-9]\d{0,8}$/;

const argument_of = (command: CommandOrigin, value: unknown): string | null => {
  if (value === null) {
    return null;
  }
  if (command === "review" && typeof value === "string" && pull_request_number.test(value)) {
    return value;
  }
  throw new Error(`invalid argument for the ${command} command turn: ${String(value).slice(0, 40)}`);
};

const parse_send = (value: unknown): SendRequest => {
  const raw = require_record(value, "send request");
  const tier = speed_tiers.find((entry) => entry === raw.tier);
  return {
    chat_id: chat_id_of(raw.chat_id),
    text: require_string(raw.text, "message text", 200_000),
    attachment_ids: parse_ids(raw.attachment_ids),
    model: require_string(raw.model, "model id", 300),
    effort: as_string(raw.effort).slice(0, 40),
    pro: raw.pro === true,
    ...(tier ? { tier } : {}),
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
  const listed = model_listing(catalog.models, model_id) ?? { entry: catalog.models[0], pro: false };
  return with_pro(context_model(listed.entry), listed.pro);
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
  handle("turn:undo", (chat_id, message_id) => undo_turn(chat_id_of(chat_id), require_string(message_id, "message id", 200)));
  handle("turn:init", (chat_id, command, argument) => {
    const parsed = command_of(command);
    return init_turn(chat_id_of(chat_id), parsed, argument_of(parsed, argument));
  });
  handle("turn:stop", (chat_id) => stop_turn(chat_id_of(chat_id)));
  handle_client("turn:hold_events", (client, chat_ids) => hold_events_for(client, as_array(chat_ids).map(chat_id_of)));
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
  handle("turn:hold_approval", (chat_id, call_id) => {
    hold_decision(chat_id_of(chat_id), require_string(call_id, "call id", 200));
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
