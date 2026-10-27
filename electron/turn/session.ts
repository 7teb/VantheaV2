import type { ApprovalDecision, ApprovalRequest, HumanDecision } from "../../shared/approval.ts";
import type { Attachment, NoticeKind, PermissionMode, SteerMessage } from "../../shared/chat.ts";
import type { StreamEventBody } from "../../shared/events.ts";
import type { ModelEntry } from "../../shared/models.ts";
import type { Language, Settings } from "../../shared/settings.ts";
import type { StoredContext } from "../context/calibration.ts";
import type { CompactAudience } from "../context/compact-text.ts";
import type { Transport } from "../model/transport.ts";
import type { RoundCallbacks, RoundRequest, RoundResult } from "../model/types.ts";
import type { ActorReview, PeerSend, SideModelCall, Tool, ToolImage, ToolProfile } from "../tools/types.ts";

export type Emitter = (body: StreamEventBody) => void;

export type StreamFn = (request: RoundRequest, callbacks: RoundCallbacks, signal: AbortSignal, transport?: Partial<Transport>) => Promise<RoundResult>;

export type SteerSource = {
  next: () => SteerMessage | null;
  noted: (steer: SteerMessage) => Promise<Attachment[]>;
  take: (steer_id: string) => void;
};

export type TurnNote = { content: string } & ({ kind: "steer"; text: string } | { kind: "notice"; notice: NoticeKind; text: string });

export type CompactionRecord = { note: string; facts: string; through_round: number };

export type CompactionHooks = {
  audience: CompactAudience;
  facts: () => Promise<string>;
  save?: (record: CompactionRecord) => Promise<void>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export type StatusRequest = { chat_id: string; language: Language; task: string; reasoning: string; previous: string };

export type ReasoningStatusCall = (request: StatusRequest, signal: AbortSignal) => Promise<string>;

export type TurnSession = {
  chat_id: string;
  message_id: string;
  user_request: string;
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
  without_tools?: string[];
  side_model: SideModelCall;
  wait_decision: (call_id: string, request: ApprovalRequest, on_hold: () => void) => Promise<ApprovalDecision>;
  review: ActorReview;
  human_decisions?: () => Promise<HumanDecision[]>;
  mirror_decision?: (decision: HumanDecision) => Promise<void>;
  steers?: SteerSource;
  profile?: ToolProfile;
  call_scope?: string;
  take_notes?: () => TurnNote[];
  idle?: () => Promise<boolean>;
  message_main?: (text: string) => boolean;
  send_peer?: PeerSend;
  store_images?: (images: ToolImage[]) => Promise<string[]>;
  compaction: CompactionHooks;
  stored_context?: StoredContext;
  reasoning_status?: ReasoningStatusCall;
  before_tools?: () => Promise<void>;
};
