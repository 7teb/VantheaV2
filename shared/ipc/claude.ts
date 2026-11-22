import type { ClaudeAccount } from "../claude.ts";
import { emit, invoke } from "./channel.ts";

export const claude_channels = {
  "claude:status": invoke<[], ClaudeAccount>(),
  "claude:refresh": invoke<[], ClaudeAccount>(),
  "claude:changed": emit<ClaudeAccount>(),
} as const;
