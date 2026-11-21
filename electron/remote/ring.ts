import { randomBytes } from "node:crypto";

export type Resume = { kind: "fresh" } | { kind: "replay"; after: number } | { kind: "resync" };

type RingEntry<T> = { seq: number; value: T };

export type Ring<T> = {
  readonly boot: string;
  seq: () => number;
  oldest: () => number;
  push: (build: (seq: number) => { value: T; size: number }) => RingEntry<T>;
  after: (seq: number) => RingEntry<T>[];
  reset: () => void;
};

export const ring_limit = 16 * 1024 * 1024;

export const backlog_limit = 8 * 1024 * 1024;

export const ping_interval_ms = 20_000;

const event_id = /^([0-9a-f]+)\.(\d+)$/;

const new_boot = () => randomBytes(6).toString("hex");

export const create_ring = <T>(limit_bytes: number): Ring<T> => {
  let entries: (RingEntry<T> & { size: number })[] = [];
  let head = 0;
  let bytes = 0;
  let boot = new_boot();
  let seq = 0;
  return {
    get boot() {
      return boot;
    },
    seq: () => seq,
    oldest: () => (head < entries.length ? entries[head].seq : seq + 1),
    push: (build) => {
      seq += 1;
      const { value, size } = build(seq);
      entries.push({ seq, value, size });
      bytes += size;
      while (bytes > limit_bytes && head < entries.length) {
        bytes -= entries[head].size;
        head += 1;
      }
      if (head > 4096 && head * 2 > entries.length) {
        entries = entries.slice(head);
        head = 0;
      }
      return { seq, value };
    },
    after: (after_seq) => entries.slice(head).flatMap((entry) => (entry.seq > after_seq ? [{ seq: entry.seq, value: entry.value }] : [])),
    reset: () => {
      boot = new_boot();
      seq = 0;
      entries = [];
      head = 0;
      bytes = 0;
    },
  };
};

export const resume_point = (last: string, current_boot: string, current_seq: number, oldest: number): Resume => {
  if (!last) {
    return { kind: "fresh" };
  }
  const match = event_id.exec(last);
  const after = match ? Number(match[2]) : -1;
  if (!match || match[1] !== current_boot || after > current_seq || after < oldest - 1) {
    return { kind: "resync" };
  }
  return { kind: "replay", after };
};
