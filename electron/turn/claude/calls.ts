import { isDeepStrictEqual } from "node:util";
import type { ToolEndStatus } from "../../../shared/events.ts";
import { engine_call_id } from "../call.ts";
import type { CarrierImage } from "../carriers.ts";
import type { Emitter } from "../session.ts";

type CallRecord = { text: string; carried: CarrierImage[] };

export type CallEntry = {
  id: string;
  name: string;
  round: number;
  index: number;
  call_id: string;
  input: Record<string, unknown> | null;
  announced: boolean;
  claimed: boolean;
  result: CallRecord | null;
};

export type CallRegistry = {
  start: (id: string, name: string, round: number, index: number) => void;
  announce: (id: string, input: Record<string, unknown>) => void;
  known: (id: string) => boolean;
  streaming: (active: boolean) => void;
  claim: (meta_id: string | null, name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<CallEntry | null>;
  record: (entry: CallEntry, result: CallRecord) => void;
  close: (id: string, status: ToolEndStatus, text: string) => void;
  forget_open: (round: number) => void;
  of_round: (round: number) => CallEntry[];
  announced: () => number;
  announced_in: (round: number) => number;
  release: () => void;
};

export const create_call_registry = (emit: Emitter, turn_signal: AbortSignal): CallRegistry => {
  const entries = new Map<string, CallEntry>();
  const early = new Map<string, Record<string, unknown>>();
  const wakers = new Set<() => void>();
  let released = false;
  let announced_count = 0;
  let open_response = false;

  const wake = () => {
    for (const waker of [...wakers]) {
      waker();
    }
  };

  const changed = (signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const done = () => {
        wakers.delete(done);
        signal.removeEventListener("abort", done);
        turn_signal.removeEventListener("abort", done);
        resolve();
      };
      wakers.add(done);
      signal.addEventListener("abort", done, { once: true });
      turn_signal.addEventListener("abort", done, { once: true });
    });

  const gone = (signal: AbortSignal) => released || turn_signal.aborted || signal.aborted;

  const announce_entry = (entry: CallEntry, input: Record<string, unknown>) => {
    if (entry.announced) {
      return;
    }
    entry.input = input;
    entry.announced = true;
    announced_count += 1;
    emit({ type: "tool_call", round: entry.round, index: entry.index, call_id: entry.call_id, name: entry.name, args: input });
    wake();
  };

  const open = (entry: CallEntry) => !entry.claimed && !entry.result;

  const find = (meta_id: string | null, name: string, args: Record<string, unknown>): CallEntry | null => {
    const by_id = meta_id === null ? undefined : entries.get(meta_id);
    if (by_id && open(by_id)) {
      return by_id;
    }
    if (meta_id !== null && !by_id && open_response) {
      return null;
    }
    const same = [...entries.values()].filter((entry) => open(entry) && entry.name === name);
    const exact = same.find((entry) => entry.announced && isDeepStrictEqual(entry.input, args));
    if (exact) {
      return exact;
    }
    if (open_response || !same.length || same.some((entry) => !entry.announced)) {
      return null;
    }
    console.warn(`[claude] call of ${name} carries arguments that differ from the announced call ${same[0].call_id}, joined by name: ${JSON.stringify(args).slice(0, 200)}`);
    return same[0];
  };

  const until_announced = async (entry: CallEntry, signal: AbortSignal): Promise<boolean> => {
    while (!entry.announced) {
      if (gone(signal)) {
        return false;
      }
      await changed(signal);
    }
    return true;
  };

  return {
    start: (id, name, round, index) => {
      if (entries.has(id)) {
        return;
      }
      const entry: CallEntry = { id, name, round, index, call_id: engine_call_id(round, index), input: null, announced: false, claimed: false, result: null };
      entries.set(id, entry);
      const input = early.get(id);
      if (input) {
        early.delete(id);
        announce_entry(entry, input);
        return;
      }
      wake();
    },
    announce: (id, input) => {
      const entry = entries.get(id);
      if (entry) {
        announce_entry(entry, input);
        return;
      }
      if (!early.has(id)) {
        early.set(id, input);
      }
    },
    known: (id) => entries.has(id),
    streaming: (active) => {
      open_response = active;
      wake();
    },
    claim: async (meta_id, name, args, signal) => {
      for (;;) {
        if (gone(signal)) {
          return null;
        }
        const entry = find(meta_id, name, args);
        if (entry) {
          entry.claimed = true;
          return (await until_announced(entry, signal)) ? entry : null;
        }
        await changed(signal);
      }
    },
    record: (entry, result) => {
      entry.result = result;
    },
    close: (id, status, text) => {
      const entry = entries.get(id);
      if (!entry || !open(entry)) {
        return;
      }
      announce_entry(entry, entry.input ?? {});
      entry.result = { text, carried: [] };
      emit({ type: "tool_end", call_id: entry.call_id, status, view: null, error: status === "failed" ? text : null, result_text: text });
    },
    forget_open: (round) => {
      for (const [id, entry] of entries) {
        if (entry.round === round && !entry.announced && !entry.claimed) {
          entries.delete(id);
        }
      }
    },
    of_round: (round) => [...entries.values()].filter((entry) => entry.round === round && entry.announced).sort((a, b) => a.index - b.index),
    announced: () => announced_count,
    announced_in: (round) => [...entries.values()].filter((entry) => entry.round === round && entry.announced).length,
    release: () => {
      released = true;
      wake();
    },
  };
};
