import assert from "node:assert/strict";
import { before, test } from "node:test";
import { css_block, declarations, read } from "./css-kit.ts";
import { bundle } from "./dom-kit.ts";

let client: any;

before(async () => {
  client = await bundle(
    [
      'export { WorkingLetters } from "./src/components/WorkingLetters.tsx";',
    ],
    [],
  );
});

type Letter = { props: { className: string; style: Record<string, number>; children: string } };

const letters = (props: Record<string, unknown>): Letter[] => {
  const children = client.WorkingLetters.type(props).props.children;
  return Array.isArray(children) ? children : [];
};

test("an active label becomes one span per letter, each with its place in the wave", () => {
  const spans = letters({ text: "Hi you" });
  assert.deepEqual(spans.map((span) => span.props.children), ["H", "i", " ", "y", "o", "u"]);
  assert.deepEqual(spans.map((span) => span.props.style["--letter"]), [0, 1, 2, 3, 4, 5]);
  assert.ok(spans.every((span) => span.props.className === "working-letter"));
});

test("letters are split by grapheme, so a combined character or emoji stays whole", () => {
  assert.deepEqual(letters({ text: "é👍🏽" }).map((span) => span.props.children), ["é", "👍🏽"]);
});

test("an inactive label renders its plain text without letter spans", () => {
  assert.equal(client.WorkingLetters.type({ text: "Read 2 files", active: false }).props.children, "Read 2 files");
});

test("the working label is a readable dim base and each letter peaks to white in turn", () => {
  const motion = read("styles/motion.css");
  assert.deepEqual(declarations(css_block(motion, ".is-working {")), { color: "var(--working-dim)" });
  const letter = declarations(css_block(motion, ".working-letter {"));
  assert.equal(letter.animation, "letter-wave 2.4s var(--ease-in-out) infinite");
  assert.equal(letter["animation-delay"], "calc(var(--letter) * 55ms)");
  const tokens = read("styles/tokens.css");
  assert.match(tokens, /--working-dim: rgba\(252, 252, 252, 0\.46\);/);
  assert.match(tokens, /--working-peak: #ffffff;/);
});
