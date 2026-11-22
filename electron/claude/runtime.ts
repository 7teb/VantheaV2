import type { AccountInfo, Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

export type ClaudeSessionRef = { session_id: string; cwd: string; through_message_id: string };

export type ClaudeQueryInput = { prompt: AsyncIterable<SDKUserMessage>; options: Options };

export type ClaudeQuery = AsyncIterable<SDKMessage> & {
  interrupt: () => Promise<unknown>;
  close: () => void;
  account: () => Promise<AccountInfo>;
  exited: Promise<void>;
  stderr_tail: () => string;
};

export type ClaudeRuntime = {
  open: (input: ClaudeQueryInput) => ClaudeQuery;
  delete_session: (session_id: string, cwd: string) => Promise<void>;
  usage_limit_prefixes: readonly string[];
  auth_failed: () => void;
};

const unwired_message = "the Claude runtime is not wired";

const initial_runtime: ClaudeRuntime = {
  open: () => {
    throw new Error(unwired_message);
  },
  delete_session: () => Promise.reject(new Error(unwired_message)),
  usage_limit_prefixes: [],
  auth_failed: () => undefined,
};

let current: ClaudeRuntime = initial_runtime;

export const set_claude_runtime = (runtime: ClaudeRuntime) => {
  current = runtime;
};

export const claude_runtime = (): ClaudeRuntime => current;
