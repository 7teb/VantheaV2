import type { TurnError } from "../../../shared/chat.ts";
import type { FinalStatus } from "../../../shared/events.ts";
import { end_error, end_status } from "../loop.ts";
import type { TurnSession } from "../session.ts";

export type TurnEnd = {
  closing: () => boolean;
  finish: (status: FinalStatus, error?: TurnError | null) => void;
  fail: (error: unknown) => Promise<void>;
  watch: (shutdown: () => void) => () => void;
  done: Promise<void>;
};

export const create_turn_end = (session: TurnSession, round: () => number, auth_failed: () => void): TurnEnd => {
  const shutdowns = new Set<() => void>();
  let settled: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    settled = resolve;
  });
  let closing = false;

  const close = () => {
    closing = true;
    for (const shutdown of [...shutdowns]) {
      shutdown();
    }
  };

  const emit_end = (status: FinalStatus, error: TurnError | null) => {
    if (error?.kind === "claude_auth") {
      auth_failed();
    }
    session.emit({ type: "end", status, error });
    settled();
  };

  return {
    closing: () => closing,
    finish: (status, error = null) => {
      if (closing) {
        return;
      }
      close();
      emit_end(status, error);
    },
    fail: async (error) => {
      if (closing) {
        return;
      }
      close();
      const turn_error = end_error(error);
      try {
        await session.hooks?.stop_failure(Math.max(round(), 0), turn_error);
      } catch (hook_error) {
        console.error(`[claude] StopFailure hooks of turn ${session.call_scope ?? session.message_id} in chat ${session.chat_id} failed:`, hook_error);
      }
      emit_end(end_status(error), turn_error);
    },
    watch: (shutdown) => {
      shutdowns.add(shutdown);
      if (closing) {
        shutdown();
      }
      return () => {
        shutdowns.delete(shutdown);
      };
    },
    done,
  };
};
