import type { ApprovalRequest } from "../approval.ts";
import type { AssistantMessage, Chat, ChatMeta, MessageUsage, PermissionMode, TurnError } from "../chat.ts";
import type { ChatgptAccount } from "../chatgpt.ts";
import type { FinalStatus, TurnEvent } from "../events.ts";
import type { FileChange } from "../file-changes.ts";
import type { EventPayload } from "../ipc/index.ts";
import type { OpenQuestion, QuestionAnswer } from "../questions.ts";
import type { BillingMode } from "../settings.ts";

export const api_version = 1;

export type ApprovalPolicy = "reject" | "client";

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden_origin"
  | "bad_host"
  | "invalid_request"
  | "unknown_model"
  | "not_found"
  | "session_busy"
  | "payload_too_large"
  | "shutting_down"
  | "internal";

export type ApiError = { error: { code: ApiErrorCode; message: string } };

export type InfoResult = {
  name: "VantheaX";
  version: string;
  api: 1;
  headless: boolean;
  default_model: string;
  default_mode: PermissionMode;
  default_approvals: ApprovalPolicy;
};

export type ModelInfo = { id: string; label: string; efforts: string[] };

export type AccountInfo = { billing: BillingMode; chatgpt: ChatgptAccount };

export type SignInRequest = { fresh?: boolean; consent?: boolean };

export type SessionOptions = { model?: string; effort?: string; mode?: PermissionMode; approvals?: ApprovalPolicy };

export type SessionCreate = { cwd: string } & SessionOptions;

export type SessionInfo = ChatMeta;

export type Session = Chat;

export type PromptRequest = { text: string; attachment_ids?: string[]; plan?: boolean } & SessionOptions;

export type WaitUntil = "idle" | "turn";

export type PromptStarted = { run_id: string; user_message_id: string; message_id: string };

export type SteerRequest = { text: string; attachment_ids?: string[] };

export type ApprovalInfo = {
  approval_id: string;
  source: "main" | "agent";
  agent_id: string | null;
  run_id: string | null;
  call_id: string;
  request: ApprovalRequest;
};

export type ApprovalReply = { approved: boolean; grant?: "once" | "prefix" | "chat" | "session"; feedback?: string };

export type QuestionsRequest = { answers?: QuestionAnswer[]; dismiss?: string[] };

export type PlanAccept = { message_id: string };

export type ChatActivity = { turn: boolean; agents: number; workflows: number; background: number; queued: number };

export type RunUsage = MessageUsage;

export type RunResult = {
  run_id: string;
  session_id: string;
  status: "running" | FinalStatus;
  error: TurnError | null;
  text: string;
  messages: AssistantMessage[];
  needs_input: { questions: OpenQuestion[]; approvals: ApprovalInfo[]; plan_message_id: string | null };
  active: ChatActivity;
  changed_files: FileChange[];
  usage: RunUsage;
  started_at: string;
  ended_at: string | null;
};

export type ApiEvent =
  | { type: "hello"; id: string; data: { boot: string; api: 1 } }
  | { type: "ping"; id: null; data: null }
  | { type: "resync"; id: null; data: null }
  | { type: "turn.event"; id: string; data: TurnEvent }
  | { type: "session.appended"; id: string; data: EventPayload<"chats:appended"> }
  | { type: "session.updated"; id: string; data: EventPayload<"chats:changed"> }
  | { type: "session.deleted"; id: string; data: EventPayload<"chats:removed"> }
  | { type: "questions.changed"; id: string; data: EventPayload<"questions:changed"> }
  | { type: "agent.event"; id: string; data: EventPayload<"agent:event"> }
  | { type: "agents.changed"; id: string; data: EventPayload<"agents:changed"> }
  | { type: "agent.approvals_changed"; id: string; data: EventPayload<"agents:approvals_changed"> }
  | { type: "background.changed"; id: string; data: EventPayload<"background:changed"> }
  | { type: "account.changed"; id: string; data: ChatgptAccount }
  | { type: "run.settled"; id: string; data: { session_id: string; run_id: string; status: FinalStatus } };
