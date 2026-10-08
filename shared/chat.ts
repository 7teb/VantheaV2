import type { ApprovalRequest, HumanDecision } from "./approval.ts";
import type { ToolView } from "./tool-view.ts";

export type PermissionMode = "ask" | "auto" | "full";

export type Attachment = {
  id: string;
  kind: "image" | "file";
  name: string;
  mime: string;
  size: number;
  vision_note: string | null;
};

export type UserOrigin = "user" | "plan_accept" | "continue" | "background" | "agent_report";

export type UserMessage = {
  id: string;
  role: "user";
  text: string;
  attachments: Attachment[];
  origin: UserOrigin;
  created_at: string;
};

export type TurnStatus = "streaming" | "done" | "stopped" | "interrupted" | "failed" | "blocked";

export type ToolStatus = "drafting" | "queued" | "running" | "awaiting_approval" | "done" | "failed" | "denied" | "cancelled";

export type ToolProgress = {
  label: string;
  lines: number | null;
  output_tail: string | null;
};

export type TextStep = { id: string; round: number; kind: "text"; text: string };

export type ReasoningStep = {
  id: string;
  round: number;
  kind: "reasoning";
  text: string;
  started_at: number;
  ended_at: number | null;
};

export type ToolStep = {
  id: string;
  round: number;
  kind: "tool";
  index: number;
  call_id: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  progress: ToolProgress | null;
  approval: ApprovalRequest | null;
  decisions?: HumanDecision[];
  view: ToolView | null;
  error: string | null;
  result_text: string;
  started_at: number | null;
  ended_at: number | null;
};

export type AssistantReference = { message_id: string; text: string };

export type SteerMessage = { id: string; text: string; attachments: Attachment[]; assistant_reference?: AssistantReference };

export type SteerStep = { id: string; round: number; kind: "steer"; text: string; steer_id?: string; attachments?: Attachment[]; assistant_reference?: AssistantReference };

export type NoticeKind = "agent_report" | "agent_update" | "update_reminder" | "plan_blocked" | "output_limit" | "todos_carried" | "context_trimmed";

export type NoticeStep = { id: string; round: number; kind: "notice"; notice: NoticeKind; text: string };

export type CompactionStep = {
  id: string;
  round: number;
  kind: "compaction";
  status: "running" | "done" | "failed";
  summary: string;
};

export type Step = TextStep | ReasoningStep | ToolStep | SteerStep | NoticeStep | CompactionStep;

export type TurnErrorKind =
  | "rate_limited"
  | "provider_unavailable"
  | "stream_interrupted"
  | "timeout"
  | "context_limit"
  | "policy"
  | "auth"
  | "credits"
  | "bad_request"
  | "app_closed"
  | "internal";

export type TurnError = { kind: TurnErrorKind; message: string };

export type RetryState = { attempt: number; max: number; reason: string; until: number };

export type ContextUsage = { used: number; limit: number };

export type RoundReasoning = { round: number; details: unknown[] };

export type AssistantMessage = {
  id: string;
  role: "assistant";
  model: string;
  effort: string;
  mode: PermissionMode;
  plan: boolean;
  created_at: string;
  ended_at: string | null;
  status: TurnStatus;
  steps: Step[];
  reasoning_details: RoundReasoning[];
  retry: RetryState | null;
  error: TurnError | null;
  context: ContextUsage | null;
  last_seq: number;
};

export type Message = UserMessage | AssistantMessage;

export type ChatSummary = { text: string; through_message_id: string };

export type ChatMeta = {
  id: string;
  title: string;
  project_path: string;
  workspace: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  message_count: number;
  streaming: boolean;
};

export type Chat = ChatMeta & {
  summary: ChatSummary | null;
  messages: Message[];
};

export type ChatSearchHit = { chat_id: string; title: string; project_path: string; snippet: string; updated_at: string };

export type Todo = { id: string; text: string; status: "pending" | "in_progress" | "done" };
