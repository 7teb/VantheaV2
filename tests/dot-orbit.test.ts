import assert from "node:assert/strict";
import { test } from "node:test";
import { orbit_keyframes, orbit_period_ms, type OrbitFrame } from "../src/components/dot-orbit.ts";

const position = (frame: OrbitFrame) => {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(frame.transform);
  assert.ok(match, frame.transform);
  return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) };
};

test("three dots loop seamlessly over one period", () => {
  assert.equal(orbit_period_ms, 7200);
  assert.equal(orbit_keyframes.length, 3);
  for (const frames of orbit_keyframes) {
    assert.equal(frames[0]?.offset, 0);
    assert.equal(frames.at(-1)?.offset, 1);
    assert.deepEqual(frames[0] && position(frames[0]), frames.at(-1) && position(frames.at(-1) as OrbitFrame));
  }
});

test("the dots start a third of an orbit apart and stay inside the 16 px slot", () => {
  const starts = orbit_keyframes.map((frames) => position(frames[0] as OrbitFrame));
  assert.equal(new Set(starts.map((start) => start.x.toFixed(1))).size, 2);
  for (const frames of orbit_keyframes) {
    for (const frame of frames) {
      const { x, y } = position(frame);
      assert.ok(Math.abs(x) <= 6 && Math.abs(y) <= 6, `${x} ${y}`);
    }
  }
});

test("seen from straight above the orbit is close to an even triangle", () => {
  const peak = Math.round(0.334 * 144);
  const scales = orbit_keyframes.map((frames) => position(frames[peak] as OrbitFrame).scale);
  assert.ok(Math.max(...scales) - Math.min(...scales) < 0.12, scales.join(" "));
});
