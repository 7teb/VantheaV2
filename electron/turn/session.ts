import type { ApprovalDecision } from "../../shared/approval.ts";
import type { NoticeKind, PermissionMode, SteerMessage } from "../../shared/chat.ts";
import type { StreamEventBody } from "../../shared/events.ts";
import type { ModelEntry } from "../../shared/models.ts";
import type { Settings } from "../../shared/settings.ts";
import type { RoundCallbacks, RoundRequest, RoundResult } from "../model/types.ts";
import type { SideModelCall, Tool, ToolProfile } from "../tools/types.ts";

export type Emitter = (body: StreamEventBody) => void;

export type StreamFn = (request: RoundRequest, callbacks: RoundCallbacks, signal: AbortSignal) => Promise<RoundResult>;

export type TurnNote = { content: string } & ({ kind: "steer"; text: string } | { kind: "notice"; notice: NoticeKind; text: string });

export type TurnSession = {
  chat_id: string;
  message_id: string;
  user_request: string;
  authorization?: () => string;
  delegated_task?: string;
  project_root: string;
  settings: Settings;
  model: ModelEntry;
  effort: string;
  mode: PermissionMode;
  plan: boolean;
  signal: AbortSignal;
  emit: Emitter;
  stream: StreamFn;
  resolve_tools: (profile: ToolProfile) => Tool[];
  side_model: SideModelCall;
  wait_decision: (call_id: string) => Promise<ApprovalDecision>;
  take_steers: () => SteerMessage[];
  profile?: ToolProfile;
  call_scope?: string;
  max_rounds?: number;
  wrap_up_at?: number;
  take_notes?: () => TurnNote[];
  idle?: () => Promise<boolean>;
  message_main?: (text: string) => boolean;
};
