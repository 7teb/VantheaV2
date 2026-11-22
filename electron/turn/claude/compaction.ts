import type { HookCallback, SDKCompactBoundaryMessage, SDKStatusMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CompactionError, CompactionSource } from "../../../shared/chat.ts";
import { context_usage } from "../../context/calibration.ts";
import type { TurnSession } from "../session.ts";

export type CompactionTracker = {
  status: (message: SDKStatusMessage) => CompactionError | null;
  boundary: (message: SDKCompactBoundaryMessage) => void;
  failed: (error: CompactionError) => void;
  summarised: () => void;
  seen: () => boolean;
  settled: () => boolean;
};

const failed_text = "Claude Code could not compact the conversation.";

export const create_compaction_tracker = (session: TurnSession, source: CompactionSource, last_round: () => number): CompactionTracker => {
  let running: number | null = null;
  let last: number | null = null;
  let boundary = false;
  let summary = false;

  const target = () => running ?? last ?? last_round() + 1;

  const failed = (error: CompactionError) => {
    const round = target();
    running = null;
    last = round;
    session.emit({ type: "compaction", round, status: "failed", source, error });
  };

  return {
    status: (message) => {
      if (message.status === "compacting" && running === null) {
        running = last_round() + 1;
        last = running;
        session.emit({ type: "compaction", round: running, status: "running", source });
      }
      if (message.compact_result !== "failed") {
        return null;
      }
      const error: CompactionError = { kind: "internal", message: message.compact_error || failed_text };
      failed(error);
      return error;
    },
    boundary: (message) => {
      const round = running ?? last_round() + 1;
      running = null;
      last = round;
      boundary = true;
      session.emit({ type: "compaction", round, status: "done", source });
      const post = message.compact_metadata.post_tokens;
      if (post !== undefined) {
        session.emit({ type: "context", usage: context_usage(post, session.model, null, 0) });
      }
    },
    failed,
    summarised: () => {
      summary = true;
    },
    seen: () => boundary,
    settled: () => boundary && summary,
  };
};

export const post_compact_hook = (session: TurnSession, last_round: () => number, saved: () => void): HookCallback => async (input) => {
  if (input.hook_event_name !== "PostCompact") {
    return {};
  }
  try {
    await session.compaction.save?.({ note: input.compact_summary, facts: await session.compaction.facts(), through_round: last_round() });
  } catch (error) {
    console.error(`[claude] saving the compaction summary of chat ${session.chat_id} after Claude Code compacted it failed:`, error);
  }
  saved();
  return {};
};
