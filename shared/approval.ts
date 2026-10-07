import type { DiffLine } from "./tool-view.ts";

export type McpTier = "readonly" | "state_change" | "dangerous" | "shell_system";

export type OverseerVerdict = { safe: boolean; reason: string; authorized?: boolean; effect_safe?: boolean };

export type ApprovalRequest =
  | {
      kind: "command";
      command: string;
      cwd: string;
      background: boolean;
      overseer: OverseerVerdict | null;
      grant_prefix: string | null;
    }
  | { kind: "write"; path: string; created: boolean; added: number; removed: number; diff: DiffLine[] }
  | { kind: "mcp"; server: string; tool: string; tier: McpTier; args_preview: string; scope: string | null }
  | { kind: "mcp_server"; name: string; command: string; args: string[]; cwd: string; env: Record<string, string>; replaces: boolean }
  | { kind: "skill_install"; name: string; description: string; files: string[]; source: string; replaces: string | null; content: string }
  | { kind: "memory"; action: "remember" | "forget"; text: string }
  | { kind: "browser_vision"; url: string };

export type GrantScope = "once" | "prefix" | "chat" | "session";

export type ApprovalDecision = { approved: boolean; grant: GrantScope; feedback: string };
