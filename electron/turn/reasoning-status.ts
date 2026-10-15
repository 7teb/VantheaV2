import type { TurnSession } from "./session.ts";

export type StatusClock = { now: () => number; after: (ms: number, run: () => void) => () => void };

export type StatusDriver = {
  reasoning: (delta: string) => void;
  close: () => void;
};

type Call = { at: number; total: number; heading_end: number };

type Phase = {
  tail: string;
  total: number;
  heading_end: number;
  called: Call | null;
  status: string;
  stop_timer: (() => void) | null;
  controller: AbortController | null;
};

export const first_status_ms = 2000;

export const refresh_ms = 10000;

export const refresh_chars = 1200;

export const text_floor = 200;

export const tail_chars = 1500;

const kept_chars = 4000;

const heading_reach = 300;

const heading = /\*\*[^*\n]{2,}\*\*/g;

const system_clock: StatusClock = {
  now: Date.now,
  after: (ms, run) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
};

const heading_end_after = (phase: Phase, fresh: number): number => {
  const window = phase.tail.slice(-(fresh + heading_reach));
  const offset = phase.total - window.length;
  let end = phase.heading_end;
  for (const match of window.matchAll(heading)) {
    end = Math.max(end, offset + match.index + match[0].length);
  }
  return end;
};

const refresh_due = (phase: Phase, now: number): boolean => {
  const called = phase.called;
  if (!called) {
    return false;
  }
  if (phase.heading_end > called.heading_end) {
    return true;
  }
  if (called.total < text_floor) {
    return phase.total >= text_floor;
  }
  return now - called.at >= refresh_ms && phase.total - called.total >= refresh_chars;
};

export const create_status_driver = (session: TurnSession, round: number, clock: StatusClock = system_clock): StatusDriver | null => {
  const call = session.reasoning_status;
  if (!call) {
    return null;
  }
  let phase: Phase | null = null;

  const request = async (current: Phase) => {
    current.controller?.abort();
    const controller = new AbortController();
    current.controller = controller;
    current.called = { at: clock.now(), total: current.total, heading_end: current.heading_end };
    const input = {
      chat_id: session.chat_id,
      language: session.settings.language,
      task: session.delegated_task ?? "",
      reasoning: current.tail.slice(-tail_chars),
      previous: current.status,
    };
    try {
      const text = await call(input, AbortSignal.any([session.signal, controller.signal]));
      if (phase !== current || controller.signal.aborted || !text || text === current.status) {
        return;
      }
      current.status = text;
      session.emit({ type: "reasoning_status", round, text });
    } catch (error) {
      if (controller.signal.aborted || session.signal.aborted) {
        return;
      }
      console.warn(`[turn] reasoning status for chat ${session.chat_id} round ${round} failed:`, error);
    } finally {
      if (current.controller === controller) {
        current.controller = null;
      }
    }
  };

  const open = (): Phase => {
    const current: Phase = { tail: "", total: 0, heading_end: 0, called: null, status: "", stop_timer: null, controller: null };
    current.stop_timer = clock.after(first_status_ms, () => {
      current.stop_timer = null;
      void request(current);
    });
    phase = current;
    return current;
  };

  const close = () => {
    if (!phase) {
      return;
    }
    phase.stop_timer?.();
    phase.controller?.abort();
    phase = null;
  };

  return {
    reasoning: (delta) => {
      if (!phase && !delta.trim()) {
        return;
      }
      const current = phase ?? open();
      current.tail = (current.tail + delta).slice(-kept_chars);
      current.total += delta.length;
      current.heading_end = heading_end_after(current, delta.length);
      if (refresh_due(current, clock.now())) {
        void request(current);
      }
    },
    close,
  };
};
