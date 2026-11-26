import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { wave_frames, wave_timing } from "../src/components/letter-wave.ts";
import { bundle, FakeElement, install_dom, quiet_vx, stub_components } from "./dom-kit.ts";

let client: any;
let container: FakeElement;
let root: any;
let restore = () => {};

before(async () => {
  const dom = install_dom(quiet_vx);
  restore = dom.restore;
  client = await bundle(
    [
      'export { createElement } from "react";',
      'export { flushSync } from "react-dom";',
      'export { createRoot } from "react-dom/client";',
      'export { WorkingLetters } from "./src/components/WorkingLetters.tsx";',
    ],
    [stub_components("WorkingLetters.tsx", {})],
  );
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
});

after(() => {
  client.flushSync(() => root.render(null));
  restore();
});

const show = (props: Record<string, unknown>) => client.flushSync(() => root.render(client.createElement(client.WorkingLetters, props)));

const letters = () => container.matching((element) => element.className === "working-letter");

test("an active label becomes one span per grapheme inside one wave span", () => {
  show({ text: "Hi you" });
  assert.equal(container.matching((element) => element.className === "working-wave").length, 1);
  assert.deepEqual(letters().map((letter) => letter.textContent), ["H", "i", " ", "y", "o", "u"]);
  show({ text: "é👍🏽" });
  assert.deepEqual(letters().map((letter) => letter.textContent), ["é", "👍🏽"]);
});

test("an inactive label renders its plain text without letter spans", () => {
  show({ text: "Read files", active: false });
  assert.equal(letters().length, 0);
  assert.equal(container.textContent, "Read files");
});

test("every letter runs its own opacity animation, offset along the label, and a new text cancels the old ones", () => {
  show({ text: "Run" });
  const first = letters();
  assert.deepEqual(
    first.map((letter) => letter.animations.at(-1)?.options),
    [0, 1, 2].map((index) => wave_timing(3, index)),
  );
  assert.ok(first.every((letter) => letter.animations.at(-1)?.frames !== undefined));
  show({ text: "Ran" });
  assert.ok(first.every((letter) => letter.animations.slice(0, -1).every((animation) => animation.cancelled)));
  assert.ok(letters().every((letter) => letter.animations.at(-1)?.cancelled === false));
});

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} is not ${expected}`);

test("one sweep crosses a label of any length within a second and starts again every 4 s", () => {
  const frames = wave_frames();
  assert.deepEqual(
    frames.map((frame) => frame.opacity),
    ["var(--working-dim-opacity)", 1, 1, "var(--working-dim-opacity)", "var(--working-dim-opacity)"],
  );
  [0, 114.2857142857, 171.4285714286, 285.7142857143, 4000].forEach((ms, index) => near((frames[index]?.offset ?? -1) * 4000, ms));
  for (const letters of [3, 8, 26]) {
    const timings = Array.from({ length: letters }, (_, index) => wave_timing(letters, index));
    assert.ok(timings.every((timing) => timing.duration === 4000 && timing.iterations === Number.POSITIVE_INFINITY && timing.easing === "linear"));
    near(timings[0]?.delay ?? -1, (0.5 / letters) * (1000 / 1.75));
    near(timings.at(-1)?.delay ?? -1, ((letters - 0.5) / letters) * (1000 / 1.75));
    assert.ok((timings.at(-1)?.delay ?? 0) + 285.7142857143 < 1000);
  }
});
