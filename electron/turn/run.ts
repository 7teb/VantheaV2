import { randomUUID } from "node:crypto";
import type { AssistantMessage, Attachment, Message, UserMessage } from "../../shared/chat.ts";
import { file_changes, undoable_turn } from "../../shared/file-changes.ts";
import type { CompactResult, SendRequest, TurnStarted } from "../../shared/ipc/chats.ts";
import type { UserOrigin } from "../../shared/chat.ts";
import { wake_idle } from "../agents/reports.ts";
import { attachment_ids, hold_ids, release_ids } from "../chats/refs.ts";
import { append_message, flush_chat, get_chat, set_streaming, truncate_after, unarchive_chat, update_message } from "../chats/store.ts";
import { chat_root } from "../chats/workspace.ts";
import { emit } from "../ipc/handle.ts";
import { forget_scan } from "../memory/store.ts";
import { find_model, resolve_effort } from "../model/catalog.ts";
import { model_catalog } from "../model/catalog-file.ts";
import { cancel_chat } from "../permissions/approvals.ts";
import { refresh_instruction_snapshot } from "../permissions/instruction-files.ts";
import { context_model } from "../settings/model-context.ts";
import { get_settings } from "../settings/store.ts";
import { describe_attachment_image } from "../side/vision.ts";
import { start_title } from "../side/title.ts";
import {
  abort_turn,
  active_turn,
  active_turns,
  clear_active,
  drop_untaken_steers,
  is_active,
  mark_user_stop,
  push_steer,
  register_active,
  release_chat,
  reserve_chat,
} from "./active.ts";
import { drive, type TurnPlan } from "./drive.ts";
import { create_emitter, type EmitDeps } from "./emit.ts";
import { uncompacted_work } from "./history.ts";
import { init_request_text } from "./init-request.ts";
import { undo_request_text } from "./undo-request.ts";
import { note_images } from "./vision-notes.ts";

const app_closed_message = "The app was closed while this turn was still running.";

const emit_deps: EmitDeps = {
  update_message,
  forward: (event) => emit("turn:event", event),
  flush: (chat_id) => {
    flush_chat(chat_id).catch((error) => console.error(`[turn] saving chat ${chat_id} after its turn ended failed:`, error));
  },
};

const iso = () => new Date().toISOString();

type Trigger = { kind: "new"; text: string; attachments: Attachment[] } | { kind: "existing"; message_id: string; text: string } | { kind: "compact" };

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

type Launched = { started: TurnStarted; finished: Promise<void> };

const last_request = (messages: Message[]): string => messages.findLast((message): message is UserMessage => message.role === "user" && message.origin === "user")?.text ?? "";

const launch = async (input: BeginInput): Promise<Launched> => {
  const chat = await get_chat(input.chat_id);
  if (!chat) {
    throw new Error(`chat ${input.chat_id} not found`);
  }
  if (chat.streaming) {
    throw new Error(`chat ${input.chat_id} is already streaming`);
  }
  const catalog = await model_catalog();
  const listed = find_model(catalog, input.model_id);
  if (!listed) {
    throw new Error(`model ${input.model_id} is not in the catalog`);
  }
  const model = context_model(listed);
  const effort = resolve_effort(model, input.effort);
  const project_root = await chat_root(chat);
  await unarchive_chat(input.chat_id);
  let user_message_id: string;
  let user_request: string;
  if (input.trigger.kind === "new") {
    const first_user = !chat.messages.some((message) => message.role === "user");
    const user: UserMessage = { id: randomUUID(), role: "user", text: input.trigger.text, attachments: input.trigger.attachments, origin: input.origin, created_at: iso() };
    await append_message(input.chat_id, user);
    user_message_id = user.id;
    user_request = input.trigger.text;
    if (first_user) {
      start_title(input.chat_id, input.trigger.text);
    }
  } else if (input.trigger.kind === "existing") {
    user_message_id = input.trigger.message_id;
    user_request = input.trigger.text;
  } else {
    user_message_id = "";
    user_request = last_request(chat.messages);
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
  const turn_plan: TurnPlan = {
    chat_id: input.chat_id,
    message_id,
    model,
    effort,
    mode: input.mode,
    plan: input.plan,
    compact_only: input.trigger.kind === "compact",
    user_request,
    project_root,
  };
  const finished = new Promise<void>((resolve) => {
    setImmediate(() => {
      void drive(turn_plan, turn).then(resolve);
    });
  });
  return { started: { user_message_id, message_id }, finished };
};

const begin = async (input: BeginInput): Promise<TurnStarted> => (await with_reservation(input.chat_id, () => launch(input))).started;

export const start_turn = (request: SendRequest, attachments: Attachment[], origin: UserOrigin): Promise<TurnStarted> =>
  begin({
    chat_id: request.chat_id,
    model_id: request.model,
    effort: request.effort,
    mode: request.mode,
    plan: request.plan,
    origin,
    trigger: { kind: "new", text: request.text, attachments },
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
      const kept = attachment_ids([target]);
      hold_ids(kept);
      try {
        await truncate_after(chat_id, prior.id);
        return (await launch({ chat_id, model_id, effort, mode, plan: false, origin: "user", trigger: { kind: "new", text, attachments: target.attachments } })).started;
      } finally {
        release_ids(kept);
      }
    }
    await truncate_after(chat_id, message_id);
    const edited: UserMessage = { ...target, text };
    update_message(chat_id, message_id, () => edited);
    emit("chats:message_replaced", { chat_id, message: edited });
    forget_scan(message_id).catch((error) => console.error(`[memory] forgetting the memory scan of edited message ${message_id} in chat ${chat_id} failed:`, error));
    return (await launch({ chat_id, model_id, effort, mode, plan: false, origin: "user", trigger: { kind: "existing", message_id, text } })).started;
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

export const undo_turn = (chat_id: string, message_id: string): Promise<TurnStarted> =>
  with_reservation(chat_id, async () => {
    const chat = await get_chat(chat_id);
    if (!chat) {
      throw new Error(`chat ${chat_id} not found`);
    }
    const turn = undoable_turn(chat.messages);
    if (!turn || turn.id !== message_id) {
      throw new Error(`message ${message_id} is not the newest turn with file changes in chat ${chat_id}; only that turn can be undone`);
    }
    const { model_id, effort, mode } = settings_request();
    const text = undo_request_text(file_changes(turn.steps));
    return (await launch({ chat_id, model_id, effort, mode, plan: false, origin: "undo", trigger: { kind: "new", text, attachments: [] } })).started;
  });

export const init_turn = (chat_id: string): Promise<TurnStarted> => {
  const { model_id, effort, mode } = settings_request();
  return begin({ chat_id, model_id, effort, mode, plan: false, origin: "init", trigger: { kind: "new", text: init_request_text, attachments: [] } });
};

export const compact_turn = async (chat_id: string): Promise<CompactResult> => {
  if (is_active(chat_id)) {
    return { status: "busy" };
  }
  const chat = await get_chat(chat_id);
  if (!chat) {
    throw new Error(`chat ${chat_id} not found`);
  }
  if (!uncompacted_work(chat.messages, chat.summary)) {
    return { status: "nothing" };
  }
  const { model_id, effort, mode } = settings_request();
  const launched = await with_reservation(chat_id, () => launch({ chat_id, model_id, effort, mode, plan: false, origin: "user", trigger: { kind: "compact" } }));
  await launched.finished;
  const message = (await get_chat(chat_id))?.messages.find((entry) => entry.id === launched.started.message_id);
  return { status: message?.role === "assistant" && message.status === "done" ? "done" : "failed" };
};

export const stop_turn = (chat_id: string): void => {
  if (active_turn(chat_id)) {
    mark_user_stop(chat_id);
  }
  abort_turn(chat_id, new Error("the user stopped the turn"));
  cancel_chat(chat_id);
};

export const steer_turn = async (chat_id: string, text: string, attachments: Attachment[], steer_id: string): Promise<string | null> => {
  const turn = active_turn(chat_id);
  if (!turn) {
    return null;
  }
  if (!push_steer(chat_id, text, steer_id, attachments)) {
    return null;
  }
  if (!turn.notes.has(steer_id)) {
    turn.notes.set(steer_id, note_images(attachments, turn.model, turn.controller.signal, describe_attachment_image));
  }
  await unarchive_chat(chat_id);
  await refresh_instruction_snapshot(chat_id);
  wake_idle(chat_id);
  return turn.message_id;
};

export const interrupt_all_turns = (): void => {
  for (const [chat_id, turn] of active_turns()) {
    turn.controller.abort(new Error(app_closed_message));
    turn.emit({ type: "end", status: "interrupted", error: { kind: "app_closed", message: app_closed_message } });
    drop_untaken_steers(chat_id, turn);
    set_streaming(chat_id, false);
    cancel_chat(chat_id);
  }
  clear_active();
};
