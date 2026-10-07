import type { ApprovalRequest, PermissionCheck } from "./approval.ts";
import type {
  AssistantMessage,
  Attachment,
  CompactionStep,
  ContextUsage,
  NoticeKind,
  ToolProgress,
  TurnError,
  TurnStatus,
} from "./chat.ts";
import type { ToolView } from "./tool-view.ts";

export type FinalStatus = Exclude<TurnStatus, "streaming">;

export type ToolEndStatus = "done" | "failed" | "denied" | "cancelled";

export type StreamEventBody =
  | { type: "text"; round: number; delta: string }
  | { type: "reasoning"; round: number; delta: string }
  | { type: "reasoning_details"; round: number; details: unknown[] }
  | { type: "retry"; round: number; attempt: number; max: number; reason: string; wait_ms: number }
  | { type: "tool_draft"; round: number; index: number; name: string; lines: number | null }
  | { type: "tool_call"; round: number; index: number; call_id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_start"; call_id: string }
  | { type: "tool_progress"; call_id: string; progress: ToolProgress }
  | { type: "tool_approval"; call_id: string; request: ApprovalRequest }
  | { type: "tool_permission"; call_id: string; check: PermissionCheck }
  | {
      type: "tool_end";
      call_id: string;
      status: ToolEndStatus;
      view: ToolView | null;
      error: string | null;
      result_text: string;
    }
  | { type: "steer"; round: number; text: string; steer_id?: string; attachments?: Attachment[] }
  | { type: "notice"; round: number; notice: NoticeKind; text: string }
  | { type: "compaction"; round: number; status: CompactionStep["status"]; summary: string }
  | { type: "context"; usage: ContextUsage }
  | { type: "end"; status: FinalStatus; error: TurnError | null };

export type Sequenced = { seq: number; at: number };

export type TurnEvent = Sequenced & StreamEventBody & { chat_id: string; message_id: string };

export type AgentEvent = Sequenced & StreamEventBody & { agent_id: string; run_id: string };

export type TranscriptState = Pick<
  AssistantMessage,
  "status" | "steps" | "reasoning_details" | "retry" | "error" | "context" | "last_seq" | "ended_at"
>;
