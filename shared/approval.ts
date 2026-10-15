import type { ReviewNote } from "./review.ts";
import type { ShellKind } from "./shell.ts";
import type { DiffLine } from "./tool-view.ts";

export type McpTier = "readonly" | "state_change" | "dangerous" | "shell_system";

type ApprovalAsk =
  | {
      kind: "command";
      command: string;
      cwd: string;
      background: boolean;
      shell?: ShellKind;
      review: ReviewNote | null;
      grant_prefix: string | null;
      source_hash?: string;
      plan?: boolean;
      plan_rule?: boolean;
      rechecked?: boolean;
    }
  | { kind: "write"; path: string; created: boolean; added: number; removed: number; diff: DiffLine[]; instruction_file?: boolean }
  | { kind: "mcp"; server: string; tool: string; tier: McpTier; args_preview: string; scope: string | null; reason?: string; review?: ReviewNote; rechecked?: boolean }
  | { kind: "mcp_server"; name: string; command: string; args: string[]; cwd: string; env: Record<string, string>; replaces: boolean; review?: ReviewNote }
  | { kind: "skill_install"; name: string; description: string; files: string[]; source: string; replaces: string | null; content: string; review?: ReviewNote }
  | { kind: "memory"; action: "remember" | "forget"; text: string; review?: ReviewNote }
  | { kind: "agent_message"; tool: AgentTextTool; to_name: string; to_id: string | null; about: string; text: string; without_tools?: string[]; review?: ReviewNote }
  | ({ kind: "secret_read"; review?: ReviewNote } & SecretRead);

export type ApprovalRequest = ApprovalAsk & { expires_at?: number };

export type AgentTextTool = "message_peer" | "message_agent" | "deploy_agent" | "continue_agent";

export type SecretReadTool = "read_file" | "grep_files" | "list_files" | "get_file_outline" | "view_image";

export type SecretRead = { tool: SecretReadTool; path: string; query: string | null };

export const secret_read_subject = (read: SecretRead): string => [`path: ${read.path}`, ...(read.query === null ? [] : [`query: ${read.query}`])].join("\n");

export type GrantScope = "once" | "prefix" | "chat" | "session" | "full_window";

export const full_window_minutes = 10;

export const approval_skip_ms = 15000;

export const skips_unanswered = (request: ApprovalRequest): boolean => request.kind !== "write" && Boolean(request.review);

export const full_mode_covers = (request: ApprovalRequest): boolean =>
  (request.kind === "command" && !request.plan) || request.kind === "write" || (request.kind === "mcp" && (request.tier === "readonly" || request.tier === "state_change"));

export type HumanDecision = {
  id: string;
  at: number;
  actor: string;
  tool: string;
  subject: string;
  cwd: string;
  approved: boolean;
  grant: GrantScope;
  feedback: string;
  reason: string;
  grant_prefix?: string;
  source_hash?: string;
  shell?: ShellKind;
  actor_id?: string;
  review_id?: string;
  last_human_id?: string | null;
  expired?: boolean;
};

export type ApprovalDecision = { approved: boolean; grant: GrantScope; feedback: string; expired?: boolean };
