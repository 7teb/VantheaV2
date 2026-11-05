import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitWindow } from "../electron/git/fetch.ts";
import { create_poller, next_round_ms, start_at, type RoundCause, type RoundFacts } from "../electron/github/poll.ts";
import { cloned_pair, fetch_rig, isolated_config, ref_of, target_of, wait_for } from "./git-fetch-kit.ts";
import { skip_without_git } from "./git-kit.ts";

await isolated_config();

const facts = (extra: Partial<RoundFacts> = {}): RoundFacts => ({
  max_age_ms: 60_000,
  poll_ms: null,
  cost: 0,
  remaining: 4990,
  reset_at: 3_600_000,
  blocked_until: null,
  anonymous: false,
  server_error: false,
  browser_step: false,
  ...extra,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const fake_window = () => {
  const listeners = new Set<() => void>();
  const window: GitWindow = {
    on_focus: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    on_blur: () => () => undefined,
    focused: () => true,
  };
  return { window, focus: () => listeners.forEach((listener) => listener()) };
};

test("the next round spreads the remaining budget until the reset, never below max-age", () => {
  const anonymous = facts({ anonymous: true, cost: 5, remaining: 55, reset_at: 3_600_000 });
  assert.equal(Math.round(next_round_ms(anonymous, 0, 0) / 1000), 327);
  assert.equal(next_round_ms(facts({ cost: 0 }), 0, 0), 60_000);
  assert.equal(next_round_ms(facts({ poll_ms: 90_000 }), 0, 0), 90_000);
});

test("a rate limit waits for the reset and server errors back off by doubling from 60 s", () => {
  assert.equal(next_round_ms(facts({ blocked_until: 900_000 }), 0, 100_000), 800_000);
  assert.equal(next_round_ms(facts(), 1, 0), 60_000);
  assert.equal(next_round_ms(facts(), 2, 0), 120_000);
  assert.equal(next_round_ms(facts(), 3, 0), 240_000);
});

test("immediate triggers skip max-age but wait for the budget only with the anonymous source", () => {
  const authorized = facts({ cost: 6, remaining: 60, reset_at: 3_600_000 });
  assert.equal(start_at("change", authorized, 10_000, false, 20_000), 20_000);
  assert.equal(start_at("refresh", authorized, 10_000, false, 20_000), 20_000);
  const anonymous = facts({ anonymous: true, cost: 6, remaining: 60, reset_at: 3_600_000 });
  assert.equal(start_at("change", anonymous, 10_000, false, 20_000), 10_000 + (3_580_000 * 6) / 60);
  assert.equal(start_at("focus", authorized, 10_000, false, 20_000), null);
  assert.equal(start_at("focus", authorized, 10_000, true, 20_000), 20_000);
  assert.equal(start_at("focus", authorized, 10_000, false, 80_000), 80_000);
  assert.equal(start_at("start", null, null, false, 5), 5);
  assert.equal(start_at("start", authorized, 10_000, false, 20_000), null);
  assert.equal(start_at("start", authorized, 10_000, true, 20_000), 20_000);
  assert.equal(start_at("start", anonymous, 10_000, false, 80_000), 10_000 + (3_520_000 * 6) / 60);
  assert.equal(start_at("refresh", facts({ blocked_until: 50_000 }), 10_000, false, 20_000), 50_000);
});

test("while a step in the browser is open, the next focus skips max-age once", async () => {
  const { window, focus } = fake_window();
  let now = 0;
  const causes: RoundCause[] = [];
  let step = true;
  const poller = create_poller(
    window,
    async (cause) => {
      causes.push(cause);
      return facts({ browser_step: step });
    },
    () => now,
  );
  try {
    poller.trigger("start");
    await settle();
    now = 10_000;
    focus();
    await settle();
    now = 20_000;
    focus();
    await settle();
    assert.deepEqual(causes, ["start", "focus"]);
    step = false;
    poller.trigger("change");
    await settle();
    now = 30_000;
    focus();
    await settle();
    assert.deepEqual(causes, ["start", "focus", "change"]);
  } finally {
    poller.stop();
  }
});

test("a new session for the same repository keeps max-age and the anonymous budget of the last one", async () => {
  const { window } = fake_window();
  let now = 0;
  const causes: RoundCause[] = [];
  const run = async (cause: RoundCause) => {
    causes.push(cause);
    return facts({ anonymous: true, cost: 6, remaining: 54, reset_at: 3_600_000 });
  };
  const first = create_poller(window, run, () => now);
  first.trigger("start");
  await settle();
  const memory = first.memory();
  first.stop();
  assert.equal(memory?.last_at, 0);
  for (const at of [30_000, 90_000]) {
    now = at;
    const next = create_poller(window, run, () => now, memory);
    try {
      next.trigger("start");
      await settle();
    } finally {
      next.stop();
    }
  }
  assert.deepEqual(causes, ["start"]);
  now = 400_000;
  const late = create_poller(window, run, () => now, memory);
  try {
    late.trigger("start");
    await settle();
  } finally {
    late.stop();
  }
  assert.deepEqual(causes, ["start", "start"]);
});

test("refresh ends the running round and starts a new one", async () => {
  const { window } = fake_window();
  const causes: RoundCause[] = [];
  const aborted: string[] = [];
  const poller = create_poller(window, (cause, signal) => {
    causes.push(cause);
    if (cause !== "start") return Promise.resolve(facts());
    return new Promise((resolve) =>
      signal.addEventListener("abort", () => {
        aborted.push(String(signal.reason));
        resolve(null);
      }),
    );
  });
  try {
    poller.trigger("start");
    await settle();
    poller.trigger("refresh");
    await settle();
    assert.deepEqual(causes, ["start", "refresh"]);
    assert.match(aborted[0] ?? "", /refresh restarts the GitHub round/);
  } finally {
    poller.stop();
  }
});

test("a head GitHub reports fetches once, the same head with the same tracking ref does not fetch again", { skip: skip_without_git }, async () => {
  const pair = await cloned_pair("gh-head");
  const rig = fetch_rig();
  const target = await target_of(pair.local);
  const tracking = ref_of(pair.local, "refs/remotes/origin/main");
  const head = { branch: "main", sha: "9".repeat(40), tracking };
  rig.fetcher.request_head(target, head);
  await wait_for("the head fetch", () => rig.fetcher.status(target.common_dir, "origin").at !== null && !rig.fetcher.status(target.common_dir, "origin").running);
  const first = rig.fetcher.status(target.common_dir, "origin").at;
  rig.fetcher.request_head(target, head);
  assert.equal(rig.fetcher.status(target.common_dir, "origin").running, false);
  await settle();
  assert.equal(rig.fetcher.status(target.common_dir, "origin").at, first);
  const pushed = await pair.push("moved");
  rig.fetcher.request_head(target, { ...head, sha: pushed });
  await wait_for("the fetch of the new head", () => ref_of(pair.local, "refs/remotes/origin/main") === pushed && !rig.fetcher.status(target.common_dir, "origin").running);
  rig.fetcher.request_head(target, { branch: "main", sha: pushed, tracking: pushed });
  assert.equal(rig.fetcher.status(target.common_dir, "origin").running, false);
});
