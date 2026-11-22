import type { ChildProcess } from "node:child_process";
import { deleteSession, query, USAGE_LIMIT_ERROR_PREFIXES, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { error_text } from "../storage/coerce.ts";
import { spawn_claude, stderr_tail_of } from "./process.ts";
import type { ClaudeQuery, ClaudeRuntime } from "./runtime.ts";

type ClaudeRuntimeDeps = {
  executable: () => string;
  env: () => Record<string, string>;
  auth_failed: () => void;
};

export const create_claude_runtime = (deps: ClaudeRuntimeDeps): ClaudeRuntime => ({
  open: ({ prompt, options }): ClaudeQuery => {
    const executable = deps.executable();
    let child: ChildProcess | null = null;
    let settle = () => {};
    const exited = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const running = query({
      prompt,
      options: {
        ...options,
        pathToClaudeCodeExecutable: executable,
        env: { ...deps.env(), ...options.env },
        spawnClaudeCodeProcess: (spawn_options) => {
          const spawned = spawn_claude(spawn_options);
          child = spawned;
          spawned.once("exit", () => settle());
          spawned.on("error", () => settle());
          return spawned;
        },
      },
    });
    const messages = async function* (): AsyncGenerator<SDKMessage, void> {
      try {
        yield* running;
      } finally {
        if (child === null) {
          settle();
        }
      }
    };
    return {
      [Symbol.asyncIterator]: messages,
      interrupt: () => running.interrupt(),
      close: () => running.close(),
      account: () => running.accountInfo(),
      exited,
      stderr_tail: () => (child === null ? "" : stderr_tail_of(child)),
    };
  },
  delete_session: async (session_id, cwd) => {
    try {
      await deleteSession(session_id, { dir: cwd });
    } catch (error) {
      console.error(`[claude] deleting the Claude Code session ${session_id} of ${cwd} failed:`, error_text(error));
    }
  },
  usage_limit_prefixes: USAGE_LIMIT_ERROR_PREFIXES,
  auth_failed: deps.auth_failed,
});
