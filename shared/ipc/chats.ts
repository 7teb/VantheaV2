import type { Chat, ChatMeta, ChatSearchHit, ContextUsage, Message, PermissionMode, UserOrigin } from "../chat.ts";
import type { ApprovalDecision } from "../approval.ts";
import type { TurnEvent } from "../events.ts";
import { emit, invoke } from "./channel.ts";

export type SendRequest = {
  chat_id: string;
  text: string;
  attachment_ids: string[];
  model: string;
  effort: string;
  mode: PermissionMode;
  plan: boolean;
  origin: UserOrigin;
};

export type TurnStarted = { user_message_id: string; message_id: string };

export type CompactResult = { status: "done" | "nothing" | "busy" | "failed" };

export type FullWindow = { chat_id: string; until: number | null };

export const chats_channels = {
  "chats:list": invoke<[], ChatMeta[]>(),
  "chats:get": invoke<[chat_id: string], Chat | null>(),
  "chats:create": invoke<[project_path: string], ChatMeta>(),
  "chats:update": invoke<[chat_id: string, patch: Partial<Pick<ChatMeta, "title" | "pinned" | "archived">>], ChatMeta>(),
  "chats:delete": invoke<[chat_id: string], void>(),
  "chats:fork": invoke<[chat_id: string, message_id: string], ChatMeta>(),
  "chats:search": invoke<[query: string], ChatSearchHit[]>(),
  "chats:changed": emit<ChatMeta>(),
  "chats:removed": emit<{ chat_id: string }>(),
  "chats:appended": emit<{ chat_id: string; message: Message }>(),
  "chats:truncated": emit<{ chat_id: string; message_id: string }>(),
  "chats:message_replaced": emit<{ chat_id: string; message: Message }>(),
  "turn:send": invoke<[request: SendRequest], TurnStarted>(),
  "turn:edit": invoke<[chat_id: string, message_id: string, text: string], TurnStarted>(),
  "turn:continue": invoke<[chat_id: string], TurnStarted>(),
  "turn:accept_plan": invoke<[chat_id: string, message_id: string], TurnStarted>(),
  "turn:undo": invoke<[chat_id: string, message_id: string], TurnStarted>(),
  "turn:init": invoke<[chat_id: string], TurnStarted>(),
  "turn:stop": invoke<[chat_id: string], void>(),
  "turn:steer": invoke<[chat_id: string, text: string, attachment_ids: string[], steer_id: string], string | null>(),
  "turn:approve": invoke<[chat_id: string, call_id: string, decision: ApprovalDecision], void>(),
  "turn:hold_approval": invoke<[chat_id: string, call_id: string], void>(),
  "turn:full_window": invoke<[chat_id: string], FullWindow>(),
  "turn:open_full_window": invoke<[chat_id: string], void>(),
  "turn:end_full_window": invoke<[chat_id: string], void>(),
  "turn:full_window_changed": emit<FullWindow>(),
  "turn:context": invoke<[chat_id: string], ContextUsage>(),
  "turn:compact": invoke<[chat_id: string], CompactResult>(),
  "turn:event": emit<TurnEvent>(),
} as const;
