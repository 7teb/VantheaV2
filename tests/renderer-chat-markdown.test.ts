import assert from "node:assert/strict";
import { test } from "node:test";
import { normalize_math, split_blocks } from "../src/components/markdown-blocks.ts";

test("blank lines outside fences split blocks and trailing blank lines are dropped", () => {
  assert.deepEqual(split_blocks("one\ntwo\n\nthree\n\n\nfour\n\n"), ["one\ntwo", "three", "four"]);
  assert.deepEqual(split_blocks(""), []);
  assert.deepEqual(split_blocks("\n\nlead"), ["lead"]);
});

test("code fences keep their blank lines inside one block", () => {
  const text = "intro\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nafter";
  assert.deepEqual(split_blocks(text), ["intro", "```ts\nconst a = 1;\n\nconst b = 2;\n```", "after"]);
});

test("a longer closing fence closes and a shorter or different marker does not", () => {
  const text = "````\n```\n\ninner\n````\n\nnext";
  assert.deepEqual(split_blocks(text), ["````\n```\n\ninner\n````", "next"]);
  const tilde = "~~~\n```\n\nstill code\n~~~\n\nout";
  assert.deepEqual(split_blocks(tilde), ["~~~\n```\n\nstill code\n~~~", "out"]);
});

test("an unclosed fence while streaming keeps everything after it in the last block", () => {
  const text = "para\n\n```py\nprint(1)\n\nprint(2)";
  assert.deepEqual(split_blocks(text), ["para", "```py\nprint(1)\n\nprint(2)"]);
});

test("display math fences stay together", () => {
  const text = "before\n\n$$\na = b\n\nc = d\n$$\n\nafter";
  assert.deepEqual(split_blocks(text), ["before", "$$\na = b\n\nc = d\n$$", "after"]);
});

test("indented continuation lines stay with the list item above", () => {
  const text = "- item\n\n  continued paragraph\n- next\n\nOutside";
  assert.deepEqual(split_blocks(text), ["- item\n\n  continued paragraph\n- next", "Outside"]);
});

test("earlier blocks stay identical while the last one grows", () => {
  const streamed = ["# Title\n\nFirst para", "# Title\n\nFirst paragraph done.\n\nSec", "# Title\n\nFirst paragraph done.\n\nSecond"];
  const blocks = streamed.map(split_blocks);
  assert.equal(blocks[1][0], blocks[2][0]);
  assert.equal(blocks[1][1], blocks[2][1]);
  assert.equal(blocks[2].length, 3);
});

test("link and footnote definitions keep the whole text in one parse", () => {
  const links = "See [the docs][docs].\n\nMore text.\n\n\n[docs]: https://example.com";
  assert.deepEqual(split_blocks(links), ["See [the docs][docs].\n\nMore text.\n\n[docs]: https://example.com"]);
  const notes = "Claim[^1].\n\nOther paragraph.\n\n[^1]: Source.\n    continued";
  assert.deepEqual(split_blocks(notes), ["Claim[^1].\n\nOther paragraph.\n\n[^1]: Source.\n    continued"]);
  const fenced = "intro\n\n```md\n[x]: https://e.com\n```\n\nafter";
  assert.deepEqual(split_blocks(fenced), ["intro", "```md\n[x]: https://e.com\n```", "after"]);
  assert.deepEqual(split_blocks("one\n\ntwo [a] and [b]"), ["one", "two [a] and [b]"]);
});

test("dollar amounts stay text while dollar math keeps its delimiters", () => {
  assert.equal(
    normalize_math("About **$1.30** for the 20 items, with a plausible range of $1.00 to $2.00."),
    "About **\\$1.30** for the 20 items, with a plausible range of \\$1.00 to \\$2.00.",
  );
  assert.equal(normalize_math("At $2.50/M that is about $1.00."), "At \\$2.50/M that is about \\$1.00.");
  assert.equal(normalize_math("costs $5 and $10"), "costs \\$5 and \\$10");
  assert.equal(normalize_math("Euler: $e^{i\\pi}+1=0$ and $x$."), "Euler: $e^{i\\pi}+1=0$ and $x$.");
  assert.equal(normalize_math("Display $$a+b$$ stays."), "Display $$a+b$$ stays.");
  assert.equal(normalize_math("inline \\( x^2 \\) here"), "inline $x^2$ here");
  assert.equal(normalize_math("already \\$5 escaped"), "already \\$5 escaped");
  assert.equal(normalize_math("a $ x $ pair"), "a \\$ x \\$ pair");
  assert.equal(normalize_math("keep `$5` in code"), "keep `$5` in code");
});

test("normalize_math converts bracket delimiters outside code only", () => {
  assert.equal(normalize_math("inline \\(x^2\\) and \\[y\\]"), "inline $x^2$ and $$y$$");
  assert.equal(normalize_math("keep `\\(x\\)` as is"), "keep `\\(x\\)` as is");
  assert.equal(normalize_math("```\n\\[z\\]\n```"), "```\n\\[z\\]\n```");
});
