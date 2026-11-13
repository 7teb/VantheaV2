import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { wave_frames, wave_timing } from "../src/components/letter-wave.ts";
import { css_block, declarations, read } from "./css-kit.ts";
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

test("every letter runs its own opacity animation, offset by 55 ms per letter, and a new text cancels the old ones", () => {
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

test("one wave per label runs at 55 ms per letter and rests about 4 s after the last letter before it starts again", () => {
  assert.deepEqual(wave_timing(20, 3), { duration: 104 * 55, delay: 165, iterations: Number.POSITIVE_INFINITY, easing: "linear" });
  assert.deepEqual(wave_frames(20), [
    { opacity: "var(--working-dim-opacity)", offset: 0 },
    { opacity: 1, offset: 6 / 104 },
    { opacity: "var(--working-dim-opacity)", offset: 12 / 104 },
    { opacity: "var(--working-dim-opacity)", offset: 1 },
  ]);
});

test("letters animate only opacity, so the wave runs on the compositor without restyling every frame", () => {
  const motion = read("components/WorkingLetters.css");
  assert.doesNotMatch(motion, /@property|@keyframes|--wave/);
  assert.deepEqual(declarations(css_block(motion, ".working-letter {")), { color: "var(--working-peak)", opacity: "var(--working-dim-opacity)" });
  assert.deepEqual(declarations(css_block(read("styles/motion.css"), ".is-working {")), { color: "var(--working-dim)" });
  const tokens = read("styles/tokens.css");
  assert.match(tokens, /--working-dim: rgba\(252, 252, 252, 0\.46\);/);
  assert.match(tokens, /--working-dim-opacity: 0\.46;/);
  assert.match(tokens, /--working-peak: #ffffff;/);
});
