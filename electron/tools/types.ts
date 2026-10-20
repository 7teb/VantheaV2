import type { ApprovalDecision, ApprovalRequest, HumanDecision } from "../../shared/approval.ts";
import type { PermissionMode, ToolProgress, ToolStep } from "../../shared/chat.ts";
import type { NativeSize } from "../../shared/image-fit.ts";
import type { PeerType } from "../../shared/peer-notes.ts";
import type { ModelEntry, SideModelRole } from "../../shared/models.ts";
import type { ReviewActor, ReviewRecord, ReviewUsage } from "../../shared/review.ts";
import type { Settings } from "../../shared/settings.ts";
import type { ToolView } from "../../shared/tool-view.ts";

export type ToolProfile = "main" | "plan" | "explore" | "worker";

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolSpec = { name: string; description: string; parameters: JsonSchema };

export type SideMessage = { role: "system" | "user" | "assistant"; content: string };

export type SideModelCall = ((role: SideModelRole, messages: SideMessage[], max_tokens: number | null, signal: AbortSignal) => Promise<string>) & { model_id?: (role: SideModelRole) => Promise<string> };

export type ReviewCall = { session_id: string; system: string; parts: { text: string; marker: boolean }[]; schema: { name: string; schema: JsonSchema } };

export type ReviewReply = { text: string; finish_reason: string | null; usage: ReviewUsage | null };

export type ReviewModelCall = ((call: ReviewCall, signal: AbortSignal) => Promise<ReviewReply>) & { prompt_room?: () => Promise<number | null> };

export type ReviewHistory = { records: ReviewRecord[]; steps: ToolStep[]; earlier_commands: number };

export type ActorReview = {
  actor: ReviewActor;
  call: ReviewModelCall;
  history: () => Promise<ReviewHistory>;
  mirror?: (entry: ReviewRecord) => Promise<void>;
};

export type Reviewer = Omit<ActorReview, "mirror"> & { record: (entry: ReviewRecord) => Promise<void> };

export type PeerRequest = { to: string; type: PeerType; about: string; summary: string; text: string; in_reply_to: string | null };

export type TextGate = { kind: "pass" } | { kind: "denied"; text: string; reason: string } | { kind: "declined"; text: string };

export type PeerSend = (request: PeerRequest) => Promise<ToolResult>;

export type ToolContext = {
  chat_id: string;
  turn_id: string;
  call_id: string;
  project_root: string;
  user_request: string;
  delegated_task?: string;
  execution_cwd?: string;
  human_decisions?: () => Promise<HumanDecision[]>;
  mode: PermissionMode;
  profile: ToolProfile;
  model: ModelEntry;
  image_fit: NativeSize[];
  settings: Settings;
  signal: AbortSignal;
  progress: (progress: ToolProgress) => void;
  approve: (request: ApprovalRequest) => Promise<ApprovalDecision>;
  side_model: SideModelCall;
  review: Reviewer;
  message_main: ((text: string) => boolean) | null;
  send_peer: PeerSend | null;
};

export type ToolImage = { bytes: Buffer; mime: string; label: string };

export type ToolResult = { status: "done" | "failed" | "denied"; text: string; view: ToolView | null; images?: ToolImage[] };

export type ToolDefinition<A> = {
  spec: ToolSpec;
  profiles: ToolProfile[];
  available?: (settings: Settings, model: ModelEntry) => boolean;
  parse: (raw: Record<string, unknown>) => A;
  run: (ctx: ToolContext, args: A) => Promise<ToolResult>;
};

export type Tool = {
  spec: ToolSpec;
  profiles: ToolProfile[];
  available: (settings: Settings, model: ModelEntry) => boolean;
  execute: (ctx: ToolContext, raw: Record<string, unknown>) => Promise<ToolResult>;
};

export class ToolArgumentError extends Error {}

export const define_tool = <A>(definition: ToolDefinition<A>): Tool => ({
  spec: definition.spec,
  profiles: definition.profiles,
  available: definition.available ?? (() => true),
  execute: (ctx, raw) => definition.run(ctx, definition.parse(raw)),
});
