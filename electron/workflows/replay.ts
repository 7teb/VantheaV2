import type { JournalRecord } from "./records.ts";

export type Hit = { status: "completed" | "skipped"; rank: number; result: unknown };

type Waiting = { rank: number; deliver: (() => number) | null };

export type Replay = {
  match: (index: number, key: string) => Hit | null;
  hold: (rank: number) => (deliver: () => number) => void;
  acked: (seq: number) => void;
  is_live: () => boolean;
  go_live: () => void;
};

const cacheable = (record: JournalRecord | undefined, key: string): Hit | null => {
  const end = record?.end;
  if (!record || record.key !== key || !end || (end.status !== "completed" && end.status !== "skipped")) {
    return null;
  }
  return { status: end.status, rank: end.rank, result: end.result };
};

export const create_replay = (journal: Map<number, JournalRecord> | null): Replay => {
  let live = journal === null || journal.size === 0;
  let awaited: number | null = 0;
  const waiting: Waiting[] = [];
  const pump = () => {
    if (live) {
      for (const entry of waiting.filter((item) => item.deliver !== null)) {
        waiting.splice(waiting.indexOf(entry), 1);
        entry.deliver?.();
      }
      return;
    }
    if (awaited !== null || !waiting.length) {
      return;
    }
    const next = waiting.reduce((best, item) => (item.rank < best.rank ? item : best));
    if (!next.deliver) {
      return;
    }
    waiting.splice(waiting.indexOf(next), 1);
    awaited = next.deliver();
  };
  return {
    match: (index, key) => {
      if (live) {
        return null;
      }
      const hit = cacheable(journal?.get(index), key);
      if (!hit) {
        live = true;
        awaited = null;
        pump();
      }
      return hit;
    },
    hold: (rank) => {
      const entry: Waiting = { rank, deliver: null };
      waiting.push(entry);
      return (deliver) => {
        entry.deliver = deliver;
        pump();
      };
    },
    acked: (seq) => {
      if (awaited === seq) {
        awaited = null;
      }
      pump();
    },
    is_live: () => live,
    go_live: () => {
      live = true;
      awaited = null;
      pump();
    },
  };
};
