import type { GitWindow } from "../git/fetch.ts";

export type RoundCause = "start" | "focus" | "change" | "refresh" | "tick";

export type RoundFacts = {
  max_age_ms: number;
  poll_ms: number | null;
  cost: number;
  remaining: number | null;
  reset_at: number | null;
  blocked_until: number | null;
  anonymous: boolean;
  server_error: boolean;
  browser_step: boolean;
};

export type RoundRun = (cause: RoundCause, signal: AbortSignal) => Promise<RoundFacts | null>;

export type PollerMemory = { facts: RoundFacts; last_at: number; failures: number; bypass: boolean };

export type Poller = { trigger: (cause: RoundCause) => void; memory: () => PollerMemory | null; stop: () => void };

export const default_max_age_ms = 60_000;

export const backoff_base_ms = 60_000;

const strength: Record<RoundCause, number> = { tick: 0, focus: 1, start: 2, change: 3, refresh: 4 };

export const spread_ms = (facts: RoundFacts, now: number): number =>
  facts.remaining === null || facts.reset_at === null ? 0 : (Math.max(0, facts.reset_at - now) * facts.cost) / Math.max(1, facts.remaining);

export const next_round_ms = (facts: RoundFacts, failures: number, now: number): number => {
  if (facts.blocked_until !== null && facts.blocked_until > now) return facts.blocked_until - now;
  if (failures > 0) return backoff_base_ms * 2 ** (failures - 1);
  return Math.max(facts.max_age_ms, spread_ms(facts, now), facts.poll_ms ?? 0);
};

export const start_at = (cause: RoundCause, facts: RoundFacts | null, last_at: number | null, bypass: boolean, now: number): number | null => {
  if (facts && facts.blocked_until !== null && facts.blocked_until > now) return facts.blocked_until;
  if (facts === null || last_at === null) return now;
  if ((cause === "focus" || cause === "start") && !bypass && now - last_at < facts.max_age_ms) return null;
  return facts.anonymous ? Math.max(now, last_at + spread_ms(facts, now)) : now;
};

export const create_poller = (window: GitWindow, run: RoundRun, now: () => number = Date.now, seed: PollerMemory | null = null): Poller => {
  let stopped = false;
  let running: AbortController | null = null;
  let queued: RoundCause | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timer_at = 0;
  let timer_cause: RoundCause = "tick";
  let facts: RoundFacts | null = seed?.facts ?? null;
  let last_at: number | null = seed?.last_at ?? null;
  let failures = seed?.failures ?? 0;
  let missed = false;
  let bypass = seed?.bypass ?? false;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const schedule = (at: number, cause: RoundCause) => {
    if (timer && timer_at <= at) return;
    clear();
    timer_at = at;
    timer_cause = cause;
    timer = setTimeout(() => {
      timer = null;
      launch(cause);
    }, Math.max(0, at - now()));
  };

  const plan_tick = () => {
    if (stopped || running || !facts || !window.focused()) return;
    schedule(Math.max(now(), (last_at ?? now()) + next_round_ms(facts, failures, now())), "tick");
  };

  const launch = (cause: RoundCause) => {
    clear();
    const controller = new AbortController();
    running = controller;
    run(cause, controller.signal)
      .then((result) => {
        if (!result) return;
        facts = result;
        failures = result.server_error ? failures + 1 : 0;
        bypass = result.browser_step && cause !== "focus";
      })
      .catch((error) => {
        if (!controller.signal.aborted) console.error(`[github] a GitHub round started by ${cause} failed:`, error);
      })
      .finally(() => {
        running = null;
        last_at = now();
        const next = queued;
        queued = null;
        if (next && !stopped) trigger(next);
        plan_tick();
      });
  };

  const trigger = (cause: RoundCause) => {
    if (stopped) return;
    if (cause === "focus" || cause === "refresh") failures = 0;
    if (cause === "change" && !window.focused()) {
      missed = true;
      return;
    }
    const effective: RoundCause = cause === "focus" && missed ? "change" : cause;
    if (running) {
      queued = queued !== null && strength[queued] >= strength[effective] ? queued : effective;
      if (effective === "refresh") running.abort(new Error("refresh restarts the GitHub round"));
      return;
    }
    const at = start_at(effective, facts, last_at, bypass, now());
    if (at === null) {
      plan_tick();
      return;
    }
    missed = false;
    if (effective === "focus" || effective === "start") bypass = false;
    if (at <= now()) launch(effective);
    else schedule(at, effective);
  };

  const focus_off = window.on_focus(() => trigger("focus"));
  const blur_off = window.on_blur(() => {
    if (timer && timer_cause !== "tick") missed = true;
    clear();
  });

  return {
    trigger,
    memory: () => (facts && last_at !== null ? { facts, last_at, failures, bypass } : null),
    stop: () => {
      stopped = true;
      clear();
      running?.abort(new Error("the GitHub session stopped"));
      focus_off();
      blur_off();
    },
  };
};
