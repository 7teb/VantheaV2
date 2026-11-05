import assert from "node:assert/strict";
import { test } from "node:test";
import { create_fetcher } from "../electron/git/fetch.ts";
import { cloned_pair, held_busy, isolated_config, ref_of, target_of, wait_for } from "./git-fetch-kit.ts";
import { skip_without_git } from "./git-kit.ts";

const options = { skip: skip_without_git };

await isolated_config();

const flags = (status: { paused: boolean; queued: boolean; running: boolean }) => ({ paused: status.paused, queued: status.queued, running: status.running });

test("a refresh that arrives while the busy check runs is queued when the repository turns out to be in use", options, async () => {
  const pair = await cloned_pair("checks-queue");
  const held = held_busy();
  const fetcher = create_fetcher(held.busy);
  const target = await target_of(pair.local);
  fetcher.request(target, "focus");
  fetcher.request(target, "refresh");
  await held.release(true);
  assert.deepEqual(flags(fetcher.status(target.common_dir, "origin")), { paused: true, queued: true, running: false });
  const pushed = await pair.push("second");
  held.busy.changed();
  await held.release(false);
  await wait_for("the queued fetch", () => fetcher.status(target.common_dir, "origin").at !== null);
  assert.equal(ref_of(pair.local, "refs/remotes/origin/main"), pushed);
  assert.deepEqual(flags(fetcher.status(target.common_dir, "origin")), { paused: false, queued: false, running: false });
});

test("a refresh that arrives while the busy check runs fetches when the repository is free", options, async () => {
  const pair = await cloned_pair("checks-free");
  const held = held_busy();
  const fetcher = create_fetcher(held.busy);
  const target = await target_of(pair.local);
  fetcher.request(target, "focus");
  fetcher.request(target, "refresh");
  await held.release(false);
  await wait_for("the fetch", () => fetcher.status(target.common_dir, "origin").at !== null);
  assert.equal(held.checks(), 1);
});

test("an end of agent work during the busy check asks again instead of trusting the old answer", options, async () => {
  const pair = await cloned_pair("checks-end");
  const held = held_busy();
  const fetcher = create_fetcher(held.busy);
  const target = await target_of(pair.local);
  fetcher.request(target, "refresh");
  held.busy.changed();
  await held.release(true);
  assert.equal(held.checks(), 2);
  await held.release(false);
  await wait_for("the fetch after the end", () => fetcher.status(target.common_dir, "origin").at !== null);
  assert.deepEqual(flags(fetcher.status(target.common_dir, "origin")), { paused: false, queued: false, running: false });
});

test("work that starts in a fetched repository pauses it right away and its end lifts the pause", options, async () => {
  const pair = await cloned_pair("checks-start");
  const held = held_busy();
  const fetcher = create_fetcher(held.busy);
  const target = await target_of(pair.local);
  fetcher.request(target, "open");
  await held.release(false);
  await wait_for("the opening fetch", () => fetcher.status(target.common_dir, "origin").at !== null && !fetcher.status(target.common_dir, "origin").running);
  const tick = fetcher.next_tick(target);
  held.busy.changed();
  await held.release(true);
  assert.deepEqual(flags(fetcher.status(target.common_dir, "origin")), { paused: true, queued: false, running: false });
  assert.ok((fetcher.next_tick(target) ?? 0) <= (tick ?? 0));
  held.busy.changed();
  await held.release(false);
  assert.deepEqual(flags(fetcher.status(target.common_dir, "origin")), { paused: false, queued: false, running: false });
  assert.equal(held.checks(), 3);
});

test("work that starts during a running fetch is checked once the fetch ends", options, async () => {
  const pair = await cloned_pair("checks-during");
  const held = held_busy();
  const fetcher = create_fetcher(held.busy);
  const target = await target_of(pair.local);
  fetcher.request(target, "refresh");
  await held.release(false);
  await wait_for("the running fetch", () => fetcher.status(target.common_dir, "origin").running || fetcher.status(target.common_dir, "origin").at !== null);
  held.busy.changed();
  await held.release(true);
  assert.deepEqual(flags(fetcher.status(target.common_dir, "origin")), { paused: true, queued: false, running: false });
  assert.notEqual(fetcher.status(target.common_dir, "origin").at, null);
});
