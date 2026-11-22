import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanUseTool, HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { claude_effort, claude_options, compact_window, managed_mcp_path, type OptionsInput } from "../electron/turn/claude/options.ts";
import { claude_harness, claude_model } from "./claude-turn-kit.ts";

const permit: CanUseTool = async (name, input) => ({ behavior: "allow", updatedInput: { ...input, name } });

const post_compact: HookCallback = async () => ({});

const options_input = (over: Partial<OptionsInput> = {}): OptionsInput => {
  const h = claude_harness([]);
  return {
    session: h.session,
    system: "the system prompt",
    effort: "high",
    resume: null,
    session_id: "11111111-1111-1111-1111-111111111111",
    title: "Chat title",
    server: new McpServer({ name: "vantheax", version: "1.0.0" }, { capabilities: { tools: {} } }),
    permit,
    post_compact,
    managed_mcp: false,
    ...over,
  };
};

test("a new session gets every documented option with VantheaX's prompt, no built-in tools and the in-process server", () => {
  const input = options_input();
  const options = claude_options(input);
  assert.deepEqual(
    { ...options, mcpServers: undefined, canUseTool: undefined, hooks: undefined },
    {
      cwd: "C:/project",
      model: "claude-opus-5-5",
      effort: "high",
      thinking: { type: "adaptive", display: "summarized" },
      systemPrompt: { type: "custom", prompt: "the system prompt", snapshot: false },
      tools: [],
      mcpServers: undefined,
      strictMcpConfig: true,
      settingSources: [],
      settings: {
        autoMemoryEnabled: false,
        autoContinueAtUsageLimit: false,
        showThinkingSummaries: true,
        includeGitInstructions: false,
        attribution: { commit: "", pr: "" },
        promptSuggestionEnabled: false,
        autoCompactWindow: 950_000,
      },
      permissionMode: "default",
      canUseTool: undefined,
      includePartialMessages: true,
      persistSession: true,
      sessionId: "11111111-1111-1111-1111-111111111111",
      title: "Chat title",
      hooks: undefined,
      env: { ENABLE_TOOL_SEARCH: "false", MAX_MCP_OUTPUT_TOKENS: "1000000" },
    },
  );
  assert.deepEqual(options.mcpServers, { vantheax: { type: "sdk", name: "vantheax", instance: input.server } });
  assert.equal(options.canUseTool, permit);
  assert.deepEqual(options.hooks, { PostCompact: [{ hooks: [post_compact] }] });
});

test("options the design never sets stay absent", () => {
  const options = claude_options(options_input()) as Record<string, unknown>;
  for (const key of [
    "maxTurns",
    "maxBudgetUsd",
    "fallbackModel",
    "agents",
    "skills",
    "plugins",
    "allowedTools",
    "disallowedTools",
    "verbatimPrompts",
    "extraArgs",
    "abortController",
    "stderr",
    "resume",
    "pathToClaudeCodeExecutable",
    "spawnClaudeCodeProcess",
    "additionalDirectories",
  ]) {
    assert.equal(key in options, false, key);
  }
  assert.equal("disableAllHooks" in (options.settings as Record<string, unknown>), false);
  assert.equal("CLAUDE_CODE_ENTRYPOINT" in (options.env as Record<string, unknown>), false);
});

test("a resumed session passes resume and neither a new session id nor a title", () => {
  const options = claude_options(options_input({ resume: { session_id: "old", cwd: "C:/project", through_message_id: "t" } }));
  assert.equal(options.resume, "old");
  assert.equal("sessionId" in options, false);
  assert.equal("title" in options, false);
});

test("strictMcpConfig is left out while the managed MCP file exists", () => {
  assert.equal(managed_mcp_path, "C:\\Program Files\\ClaudeCode\\managed-mcp.json");
  assert.equal("strictMcpConfig" in claude_options(options_input({ managed_mcp: true })), false);
  assert.equal(claude_options(options_input({ managed_mcp: false })).strictMcpConfig, true);
});

test("the effort narrows to Claude Code's levels, major maps to max and anything else is claude_model", () => {
  const session = (effort: string) => ({ ...claude_harness([]).session, effort, model: { ...claude_model, efforts: [...claude_model.efforts, "major"] } });
  assert.equal(claude_effort(session("low")), "low");
  assert.equal(claude_effort(session("xhigh")), "xhigh");
  assert.equal(claude_effort(session("major")), "max");
});

test("an effort outside Claude Code's levels throws claude_model", () => {
  const session = { ...claude_harness([]).session, effort: "minimal", model: { ...claude_model, efforts: ["minimal"], default_effort: "minimal" } };
  assert.throws(() => claude_effort(session), (error: Error & { kind?: string }) => error.kind === "claude_model" && error.message === "Claude Code does not take the effort minimal for Claude Opus 5.5.");
});

test("the auto-compact window follows the chat's limit and percent with Claude Code's floor of 100000", () => {
  assert.equal(compact_window(claude_model), 950_000);
  assert.equal(compact_window({ ...claude_model, context_length: 200_000, compact_at: 0.8 }), 160_000);
  assert.equal(compact_window({ ...claude_model, context_length: 100_000, compact_at: 0.95 }), 100_000);
});
