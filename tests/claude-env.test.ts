import assert from "node:assert/strict";
import { test } from "node:test";
import { claude_env } from "../electron/claude/env.ts";

const removed = [
  "CLAUDECODE",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_HOST_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_DESKTOP_APP_VERSION",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_EFFORT",
  "CLAUDE_PID",
  "CLAUDE_AGENT_SDK_VERSION",
  "CLAUDE_AUTO_BACKGROUND_TASKS",
  "CLAUDE_CODE_SIMPLE",
  "CLAUDE_CODE_RESUME_INTERRUPTED_TURN",
  "CLAUDE_CODE_RESUME_PROMPT",
  "CLAUDE_CODE_RESUME_REASON",
  "CLAUDE_CODE_ACCOUNT_UUID",
  "CLAUDE_CODE_ORGANIZATION_UUID",
  "CLAUDE_CODE_USER_EMAIL",
  "CLAUDE_CODE_OAUTH_SCOPES",
  "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH",
  "CLAUDE_CODE_EAGER_FLUSH",
  "CLAUDE_CODE_EMIT_STARTUP_TIMING",
  "CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES",
  "CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL",
  "CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING",
  "CLAUDE_CODE_HOST_SHORT_TEMP_DIRS",
  "CLAUDE_CODE_REPORT_FINDINGS",
  "CLAUDE_CODE_TERMINAL_MCP_TOOLS",
  "CLAUDE_PREVIEW_CLASSIFIER_FLOOR",
  "DISABLE_MICROCOMPACT",
  "ELECTRON_RUN_AS_NODE",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_PROFILE",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD",
  "CLAUDE_CODE_USE_MANTLE",
  "CLAUDE_CODE_USE_GATEWAY",
  "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
  "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
  "CLAUDE_CODE_SESSION_ACCESS_TOKEN",
  "CLAUDE_CODE_CUSTOM_OAUTH_URL",
  "CLAUDE_CODE_API_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_AWS_API_KEY",
  "ANTHROPIC_FOUNDRY_API_KEY",
  "ANTHROPIC_FOUNDRY_AUTH_TOKEN",
  "ANTHROPIC_IDENTITY_TOKEN",
  "ANTHROPIC_IDENTITY_TOKEN_FILE",
  "ANTHROPIC_AWS_BASE_URL",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
  "ANTHROPIC_FOUNDRY_BASE_URL",
  "ANTHROPIC_GOOGLE_CLOUD_BASE_URL",
  "ANTHROPIC_VERTEX_BASE_URL",
];

const added = {
  CLAUDE_CODE_ENTRYPOINT: "vantheax",
  CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: "0",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
  CLAUDE_CODE_STARTUP_FAILURE_RESULTS: "1",
  ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  CLAUDE_CODE_AUTO_CONNECT_IDE: "false",
  CLAUDE_AGENT_SDK_MCP_NO_PREFIX: "1",
  CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
  CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: "false",
};

const mixed_case = (name: string, index: number): string =>
  [...name].map((letter, position) => ((position + index) % 2 === 0 ? letter.toLowerCase() : letter)).join("");

test("claude_env drops every inherited session and credential variable in any letter case", () => {
  for (const [index, name] of removed.entries()) {
    for (const spelling of [name, name.toLowerCase(), mixed_case(name, index)]) {
      const env = claude_env({ [spelling]: "inherited", PATH: "C:\\Windows" });
      assert.ok(!Object.keys(env).some((key) => key.toUpperCase() === name), spelling);
      assert.equal(env.PATH, "C:\\Windows");
    }
  }
});

test("claude_env sets the added variables, overriding inherited spellings of them", () => {
  const env = claude_env({ claude_code_disable_auto_memory: "0", Enable_ClaudeAI_MCP_Servers: "true", CLAUDE_CODE_AUTO_CONNECT_IDE: "true" });
  for (const [name, value] of Object.entries(added)) {
    assert.equal(env[name], value, name);
    assert.deepEqual(Object.keys(env).filter((key) => key.toUpperCase() === name), [name]);
  }
});

test("claude_env keeps CLAUDE_CONFIG_DIR, HOME, USERPROFILE and unrelated variables, skips undefined values and sets the VantheaX entrypoint", () => {
  const env = claude_env({
    CLAUDE_CONFIG_DIR: "D:\\claude-config",
    HOME: "C:\\Users\\someone",
    USERPROFILE: "C:\\Users\\someone",
    Path: "C:\\Windows",
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: "64000",
    EMPTY: undefined,
  });
  assert.equal(env.CLAUDE_CONFIG_DIR, "D:\\claude-config");
  assert.equal(env.HOME, "C:\\Users\\someone");
  assert.equal(env.USERPROFILE, "C:\\Users\\someone");
  assert.equal(env.Path, "C:\\Windows");
  assert.equal(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, "64000");
  assert.equal(Object.hasOwn(env, "EMPTY"), false);
  assert.deepEqual(Object.keys(env).filter((key) => key.toUpperCase() === "CLAUDE_CODE_ENTRYPOINT"), ["CLAUDE_CODE_ENTRYPOINT"]);
  assert.equal(env.CLAUDE_CODE_ENTRYPOINT, "vantheax");
  assert.equal(Object.keys(env).length, 5 + Object.keys(added).length);
});

test("claude_env reads process.env by default and leaves it untouched", () => {
  const before = { ...process.env };
  const env = claude_env();
  assert.deepEqual({ ...process.env }, before);
  assert.equal(env.CLAUDE_CODE_STARTUP_FAILURE_RESULTS, "1");
  assert.ok(!Object.keys(env).some((key) => key.toUpperCase() === "ANTHROPIC_API_KEY"));
});
