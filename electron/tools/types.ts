import type { ApprovalDecision, ApprovalRequest, HumanDecision } from "../../shared/approval.ts";
import type { PermissionMode, ToolProgress } from "../../shared/chat.ts";
import type { SideModelRole } from "../../shared/models.ts";
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

export type SideModelCall = ((role: SideModelRole, messages: SideMessage[], max_tokens: number, signal: AbortSignal) => Promise<string>) & { model_id?: (role: SideModelRole) => Promise<string> };

export type ToolContext = {
  chat_id: string;
  turn_id: string;
  call_id: string;
  project_root: string;
  user_request: string;
  authorization?: () => string;
  delegated_task?: string;
  execution_cwd?: string;
  human_decisions?: () => Promise<HumanDecision[]>;
  mode: PermissionMode;
  profile: ToolProfile;
  settings: Settings;
  signal: AbortSignal;
  progress: (progress: ToolProgress) => void;
  approve: (request: ApprovalRequest) => Promise<ApprovalDecision>;
  side_model: SideModelCall;
  message_main: ((text: string) => boolean) | null;
};

export type ToolResult = { status: "done" | "failed" | "denied"; text: string; view: ToolView | null };

export type ToolDefinition<A> = {
  spec: ToolSpec;
  profiles: ToolProfile[];
  available?: (settings: Settings) => boolean;
  parse: (raw: Record<string, unknown>) => A;
  run: (ctx: ToolContext, args: A) => Promise<ToolResult>;
};

export type Tool = {
  spec: ToolSpec;
  profiles: ToolProfile[];
  available: (settings: Settings) => boolean;
  execute: (ctx: ToolContext, raw: Record<string, unknown>) => Promise<ToolResult>;
};

export class ToolArgumentError extends Error {}

export const define_tool = <A>(definition: ToolDefinition<A>): Tool => ({
  spec: definition.spec,
  profiles: definition.profiles,
  available: definition.available ?? (() => true),
  execute: (ctx, raw) => definition.run(ctx, definition.parse(raw)),
});
