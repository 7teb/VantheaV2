import type { CanUseTool, EffortLevel, HookCallback, Options } from "@anthropic-ai/claude-agent-sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ModelEntry } from "../../../shared/models.ts";
import type { ClaudeSessionRef } from "../../claude/runtime.ts";
import { compact_threshold } from "../../context/compact.ts";
import { api_effort } from "../../model/catalog.ts";
import { ModelError } from "../../model/errors.ts";
import type { TurnSession } from "../session.ts";
import { server_name } from "./names.ts";

export const managed_mcp_path = "C:\\Program Files\\ClaudeCode\\managed-mcp.json";

const efforts: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

const min_compact_window = 100_000;

export const claude_effort = (session: TurnSession): EffortLevel => {
  const effort = api_effort(session.model, session.effort);
  const level = efforts.find((entry) => entry === effort);
  if (!level) {
    throw new ModelError("claude_model", `Claude Code does not take the effort ${effort} for ${session.model.label}.`);
  }
  return level;
};

export const compact_window = (model: ModelEntry): number => Math.max(min_compact_window, Math.floor(model.context_length * compact_threshold(model)));

export type OptionsInput = {
  session: TurnSession;
  system: string;
  effort: EffortLevel;
  resume: ClaudeSessionRef | null;
  session_id: string;
  title: string;
  server: McpServer;
  permit: CanUseTool;
  post_compact: HookCallback;
  managed_mcp: boolean;
};

export const claude_options = (input: OptionsInput): Options => ({
  cwd: input.session.project_root,
  model: input.session.model.claude_code,
  effort: input.effort,
  thinking: { type: "adaptive", display: "summarized" },
  systemPrompt: { type: "custom", prompt: input.system, snapshot: false },
  tools: [],
  mcpServers: { [server_name]: { type: "sdk", name: server_name, instance: input.server } },
  ...(input.managed_mcp ? {} : { strictMcpConfig: true }),
  settingSources: [],
  settings: {
    autoMemoryEnabled: false,
    autoContinueAtUsageLimit: false,
    showThinkingSummaries: true,
    includeGitInstructions: false,
    attribution: { commit: "", pr: "" },
    promptSuggestionEnabled: false,
    autoCompactWindow: compact_window(input.session.model),
  },
  permissionMode: "default",
  canUseTool: input.permit,
  includePartialMessages: true,
  persistSession: true,
  ...(input.resume ? { resume: input.resume.session_id } : { sessionId: input.session_id, title: input.title }),
  hooks: { PostCompact: [{ hooks: [input.post_compact] }] },
  env: { ENABLE_TOOL_SEARCH: "false", MAX_MCP_OUTPUT_TOKENS: String(input.session.model.context_length) },
});
