import assert from "node:assert/strict";
import { test } from "node:test";
import { heartbeat_keyframes, heartbeat_period_ms } from "../src/components/dot-heartbeat.ts";
import { juggle_keyframes, juggle_period_ms } from "../src/components/dot-juggle.ts";
import { orbit_keyframes, orbit_period_ms } from "../src/components/dot-orbit.ts";
import { bridge_frames, bridge_ms, dot_motions, emerge_frames, emerge_ms, first_motion, next_motion } from "../src/components/dot-sequence.ts";
import { shuffle_keyframes, shuffle_period_ms } from "../src/components/dot-shuffle.ts";
import { weave_keyframes, weave_period_ms } from "../src/components/dot-weave.ts";

const numbers = (transform: string | undefined) => (transform ?? "").match(/-?[\d.]+/g)?.map(Number) ?? [];

const indexes = dot_motions.map((_, index) => index);

test("the spinner knows five motions with their own durations", () => {
  assert.deepEqual(
    dot_motions.map((motion) => motion.duration),
    [orbit_period_ms, weave_period_ms, shuffle_period_ms, juggle_period_ms, heartbeat_period_ms],
  );
  assert.deepEqual(
    dot_motions.map((motion) => motion.frames),
    [orbit_keyframes, weave_keyframes, shuffle_keyframes, juggle_keyframes, heartbeat_keyframes],
  );
  assert.ok(bridge_ms > 0 && bridge_ms < 1000);
});

test("the first motion is random over all five and the next one is random but never the same motion again", () => {
  assert.equal(first_motion(() => 0), 0);
  assert.equal(first_motion(() => 0.9999), dot_motions.length - 1);
  assert.deepEqual(new Set(indexes.map((index) => first_motion(() => index / dot_motions.length))), new Set(indexes));
  for (const from of indexes) {
    const reachable = new Set(Array.from({ length: 600 }, (_, step) => next_motion(from, () => step / 600)));
    assert.equal(reachable.has(from), false, `motion ${from} follows itself`);
    assert.equal(reachable.size, dot_motions.length - 1, `motion ${from} reaches every other motion`);
  }
  assert.equal(next_motion(2, () => 0), 3);
  assert.equal(next_motion(2, () => 0.9999), 1);
});

test("each bridge gathers all three dots into one point in the middle before the next motion unfolds from it", () => {
  for (const from of indexes) {
    for (const to of indexes.filter((index) => index !== from)) {
      for (const dot of [0, 1, 2]) {
        const [start, gathered, held, end, ...rest] = bridge_frames(dot_motions[from], dot_motions[to], dot);
        const last = dot_motions[from].frames[dot].at(-1);
        const first = dot_motions[to].frames[dot][0];
        assert.equal(rest.length, 0);
        assert.deepEqual([start?.offset, gathered?.offset, held?.offset, end?.offset], [0, 0.42, 0.58, 1]);
        assert.deepEqual([start?.transform, start?.opacity], [last?.transform, last?.opacity]);
        assert.deepEqual([end?.transform, end?.opacity], [first?.transform, first?.opacity]);
        for (const point of [gathered, held]) {
          assert.deepEqual(numbers(point?.transform as string), [0, 0, 1]);
          assert.equal(point?.opacity, 1);
        }
        assert.equal(numbers(start?.transform as string).length, 3);
      }
    }
  }
});

test("the spinner unfolds its first motion from the middle point instead of appearing in place", () => {
  for (const motion of dot_motions) {
    for (const dot of [0, 1, 2]) {
      const [start, end, ...rest] = emerge_frames(motion, dot);
      assert.equal(rest.length, 0);
      assert.deepEqual(numbers(start?.transform as string), [0, 0, 1]);
      assert.deepEqual([end?.offset, end?.transform, end?.opacity], [1, motion.frames[dot][0].transform, motion.frames[dot][0].opacity]);
    }
  }
  assert.ok(emerge_ms > 0 && emerge_ms < bridge_ms);
});

for (const [name, keyframes] of [
  ["weave", weave_keyframes],
  ["shuffle", shuffle_keyframes],
  ["juggle", juggle_keyframes],
  ["heartbeat", heartbeat_keyframes],
] as const) {
  test(`the ${name} loops seamlessly, stacks the three dots in a valid order and stays inside the slot`, () => {
    assert.equal(keyframes.length, 3);
    for (const frames of keyframes) {
      assert.equal(frames[0]?.offset, 0);
      assert.equal(frames.at(-1)?.offset, 1);
      const [first, last] = [numbers(frames[0]?.transform), numbers(frames.at(-1)?.transform)];
      assert.equal(first.length, 3);
      first.forEach((value, index) => assert.ok(Math.abs(value - (last[index] ?? Number.NaN)) < 0.02, `${first} vs ${last}`));
      for (const frame of frames) {
        const [x, y] = numbers(frame.transform);
        assert.ok(Math.abs(x ?? 99) <= 7 && Math.abs(y ?? 99) <= 7, frame.transform);
        assert.ok(frame.opacity > 0 && frame.opacity <= 1, String(frame.opacity));
      }
    }
    for (let step = 0; step < keyframes[0].length; step += 1) {
      const order = keyframes.map((frames) => frames[step]?.zIndex).sort();
      assert.deepEqual(order, [1, 2, 3]);
    }
  });
}
