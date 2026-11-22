import type { ClaudeSessionRef } from "../../claude/runtime.ts";

export const claude_session_resumable = (stored: ClaudeSessionRef | null, cwd: string, previous_turn_id: string | null): boolean =>
  stored !== null && stored.cwd === cwd && previous_turn_id !== null && stored.through_message_id === previous_turn_id;
