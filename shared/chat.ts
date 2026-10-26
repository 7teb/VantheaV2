import type { ApprovalRequest, HumanDecision } from "./approval.ts";
import type { QuestionStates } from "./questions.ts";
import type { ReviewRecord } from "./review.ts";
import type { ToolView } from "./tool-view.ts";

export type PermissionMode = "ask" | "auto" | "full";

export type AttachmentModel = { id: string; width: number; height: number };

export type Attachment = {
  id: string;
  kind: "image" | "file";
  name: string;
  mime: string;
  size: number;
  vision_note: string | null;
  width?: number;
  height?: number;
  model?: AttachmentModel;
  source_path?: string;
};

export type UserOrigin = "user" | "plan_accept" | "undo" | "init" | "git_init" | "continue" | "background" | "agent_report" | "agent_update";

export type CommandOrigin = Extract<UserOrigin, "init" | "git_init">;

export const command_origins: readonly CommandOrigin[] = ["init", "git_init"];

export const human_origin = (origin: UserOrigin): boolean => origin === "user" || origin === "plan_accept" || origin === "undo" || origin === "init" || origin === "git_init";

export const instruction_origin = (origin: UserOrigin): boolean => human_origin(origin) || origin === "continue";

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
  draft_text?: string;
  draft_path?: string;
  draft_old?: string;
  phase?: "review";
  can_background?: boolean;
};

export type TextStep = { id: string; round: number; kind: "text"; text: string };

export type ReasoningStep = {
  id: string;
  round: number;
  kind: "reasoning";
  text: string;
  started_at: number;
  ended_at: number | null;
  status_line?: string;
};

export type StepImage = { id: string; label: string };

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
  reviews?: ReviewRecord[];
  view: ToolView | null;
  error: string | null;
  result_text: string;
  images?: StepImage[];
  started_at: number | null;
  ended_at: number | null;
};

export type AssistantReference = { message_id: string; text: string };

export type SteerMessage = { id: string; text: string; at: number; attachments: Attachment[]; assistant_reference?: AssistantReference };

export type SteerStep = { id: string; round: number; kind: "steer"; text: string; at?: number; steer_id?: string; attachments?: Attachment[]; assistant_reference?: AssistantReference };

export type NoticeKind =
  | "agent_report"
  | "agent_update"
  | "update_reminder"
  | "plan_blocked"
  | "output_limit"
  | "todos_carried"
  | "context_trimmed"
  | "agent_roster"
  | "peer_message"
  | "peer_status"
  | "peer_digest";

export type NoticeStep = { id: string; round: number; kind: "notice"; notice: NoticeKind; text: string };

export type CompactionSource = "auto" | "manual";

export type CompactionStatus = "running" | "waiting" | "done" | "failed" | "interrupted";

export type CompactionStep = {
  id: string;
  round: number;
  kind: "compaction";
  status: CompactionStatus;
  source?: CompactionSource;
  started_at?: number;
  attempt?: number;
  attempts?: number;
  error?: CompactionError;
  retry_at?: number;
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

export type CompactionErrorKind = TurnErrorKind | "empty_note";

export type CompactionError = { kind: CompactionErrorKind; message: string };

export type RetryState = { attempt: number; max: number; reason: string; until: number };

export type ContextCalibration = { prompt_tokens: number; estimate: number };

export type ContextParts = { system: number; tools: number; messages: number };

export type ContextUsage = { used: number; limit: number; calibration?: ContextCalibration; floor?: number; parts?: ContextParts };

export const compact_fraction = 0.7;

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

export const own_send = (message: Message): boolean => message.role === "user" && instruction_origin(message.origin);

export const has_work = (message: Message): boolean => message.role === "assistant" && message.steps.some((step) => step.kind === "text" || step.kind === "tool");

export const manual_compaction_only = (message: AssistantMessage): boolean =>
  message.steps.length > 0 && message.steps.every((step) => step.kind === "compaction" && step.source === "manual");

export const user_steers = (message: AssistantMessage): string[] =>
  message.steps.flatMap((step) => (step.kind === "steer" && step.steer_id && step.text.trim() ? [step.text] : []));

export const message_attachments = (message: Message): Attachment[] =>
  message.role === "user" ? message.attachments : message.steps.flatMap((step) => (step.kind === "steer" ? (step.attachments ?? []) : []));

export type ChatSummary = { text: string; through_message_id: string; through_round?: number; facts?: string };

export type ChatMeta = {
  id: string;
  title: string;
  project_path: string;
  workspace: string;
  pinned: boolean;
  archived?: boolean;
  created_at: string;
  updated_at: string;
  message_count: number;
  streaming: boolean;
};

export type Chat = ChatMeta & {
  summary: ChatSummary | null;
  messages: Message[];
  questions: QuestionStates;
};

export type ChatSearchHit = { chat_id: string; title: string; project_path: string; snippet: string; updated_at: string; archived?: boolean };

export type Todo = { id: string; text: string; status: "pending" | "in_progress" | "done" };
