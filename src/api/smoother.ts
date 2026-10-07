import type { Message } from "../../shared/chat.ts";
import type { TurnEvent } from "../../shared/events.ts";

export type StreamItem =
  | { kind: "event"; event: TurnEvent }
  | { kind: "appended"; chat_id: string; message: Message }
  | { kind: "replaced"; chat_id: string; message: Message }
  | { kind: "truncated"; chat_id: string; message_id: string };

export type Delivery =
  | { kind: "event"; event: TurnEvent; partial: boolean }
  | { kind: "appended"; chat_id: string; message: Message }
  | { kind: "replaced"; chat_id: string; message: Message }
  | { kind: "truncated"; chat_id: string; message_id: string };

export type SmootherClock = {
  now: () => number;
  schedule: (run: () => void, delay_ms: number) => number;
  cancel: (handle: number) => void;
  hidden: () => boolean;
};

export type Smoother = {
  push: (item: StreamItem) => void;
  flush: () => void;
  dispose: () => void;
};

type TextEvent = Extract<TurnEvent, { type: "text" | "reasoning" }>;

type Pending = { kind: "text"; event: TextEvent; rest: string } | { kind: "item"; item: StreamItem };

type Lane = { pending: Pending[]; queued_chars: number; last_arrival: number; gap_ema: number };

export const tick_ms = 16;
const min_chars_per_ms = 0.09;
const max_chars_per_ms = 6;
const min_horizon_ms = 350;
const max_horizon_ms = 4000;
const close_horizon_ms = 250;
const burst_gap_ms = 2000;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const item_chat = (item: StreamItem) => (item.kind === "event" ? item.event.chat_id : item.chat_id);

const is_text = (event: TurnEvent): event is TextEvent => (event.type === "text" || event.type === "reasoning") && event.delta.length > 0;

const as_delivery = (item: StreamItem): Delivery => (item.kind === "event" ? { kind: "event", event: item.event, partial: false } : item);

const safe_cut = (text: string, count: number) => {
  if (count >= text.length) {
    return text.length;
  }
  const code = text.charCodeAt(count - 1);
  return code >= 0xd800 && code <= 0xdbff ? count + 1 : count;
};

const horizon = (lane: Lane) => {
  if (lane.pending.some((entry) => entry.kind === "item")) {
    return close_horizon_ms;
  }
  if (lane.gap_ema === 0) {
    return min_horizon_ms * 2;
  }
  return clamp(lane.gap_ema * 1.6, min_horizon_ms, max_horizon_ms);
};

const drain_lane = (lane: Lane, budget: number | null, out: Delivery[]) => {
  let left = budget;
  while (lane.pending.length > 0) {
    const head = lane.pending[0];
    if (head.kind === "item") {
      out.push(as_delivery(head.item));
      lane.pending.shift();
      continue;
    }
    if (left !== null && left <= 0) {
      return;
    }
    const count = safe_cut(head.rest, left === null ? head.rest.length : Math.min(left, head.rest.length));
    const piece = head.rest.slice(0, count);
    head.rest = head.rest.slice(count);
    lane.queued_chars -= count;
    if (left !== null) {
      left -= count;
    }
    out.push({ kind: "event", event: { ...head.event, delta: piece }, partial: head.rest.length > 0 });
    if (head.rest.length === 0) {
      lane.pending.shift();
    }
  }
};

export const create_smoother = (deliver: (batch: Delivery[]) => void, clock: SmootherClock): Smoother => {
  const lanes = new Map<string, Lane>();
  let timer: number | null = null;
  let last_tick = 0;

  const lane_for = (chat_id: string): Lane => {
    const existing = lanes.get(chat_id);
    if (existing) {
      return existing;
    }
    const lane: Lane = { pending: [], queued_chars: 0, last_arrival: 0, gap_ema: 0 };
    lanes.set(chat_id, lane);
    return lane;
  };

  const busy = () => [...lanes.values()].some((lane) => lane.pending.length > 0);

  const cancel_timer = () => {
    if (timer !== null) {
      clock.cancel(timer);
      timer = null;
    }
  };

  const flush = () => {
    cancel_timer();
    last_tick = 0;
    const out: Delivery[] = [];
    for (const lane of lanes.values()) {
      drain_lane(lane, null, out);
    }
    if (out.length > 0) {
      deliver(out);
    }
  };

  const tick = () => {
    timer = null;
    const now = clock.now();
    const dt = last_tick === 0 ? tick_ms : Math.min(now - last_tick, 1000);
    last_tick = now;
    if (clock.hidden()) {
      flush();
      return;
    }
    const out: Delivery[] = [];
    for (const lane of lanes.values()) {
      if (lane.pending.length === 0) {
        continue;
      }
      const rate = clamp(lane.queued_chars / horizon(lane), min_chars_per_ms, max_chars_per_ms);
      drain_lane(lane, Math.max(1, Math.round(rate * dt)), out);
    }
    if (out.length > 0) {
      deliver(out);
    }
    if (busy()) {
      timer = clock.schedule(tick, tick_ms);
      return;
    }
    last_tick = 0;
  };

  const note_arrival = (lane: Lane) => {
    const now = clock.now();
    const gap = lane.last_arrival === 0 ? 0 : now - lane.last_arrival;
    lane.last_arrival = now;
    if (gap === 0) {
      return;
    }
    if (gap > burst_gap_ms) {
      lane.gap_ema = 0;
      return;
    }
    lane.gap_ema = lane.gap_ema === 0 ? gap : lane.gap_ema * 0.7 + gap * 0.3;
  };

  const push = (item: StreamItem) => {
    const lane = lane_for(item_chat(item));
    if (item.kind === "event" && is_text(item.event)) {
      note_arrival(lane);
      lane.pending.push({ kind: "text", event: item.event, rest: item.event.delta });
      lane.queued_chars += item.event.delta.length;
    } else if (lane.pending.length === 0) {
      deliver([as_delivery(item)]);
      return;
    } else {
      lane.pending.push({ kind: "item", item });
    }
    if (clock.hidden()) {
      flush();
      return;
    }
    if (timer === null) {
      timer = clock.schedule(tick, tick_ms);
    }
  };

  const dispose = () => {
    cancel_timer();
    lanes.clear();
  };

  return { push, flush, dispose };
};
