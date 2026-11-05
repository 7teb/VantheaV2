import assert from "node:assert/strict";
import { test } from "node:test";
import { has_math, normalize_math, split_blocks } from "../src/components/markdown-blocks.ts";

const sed = String.raw`sed -e 's/\(foo\)/x/'`;

const normalize_blocks = (text: string) => split_blocks(text).map(normalize_math);

test("tilde fences keep dollars and bracket delimiters exactly as written", () => {
  const fence = `~~~bash\necho $HOME\n${sed}\nprice=$5 and $a$b\n~~~`;
  assert.equal(normalize_math(fence), fence);
  assert.equal(has_math(normalize_math(fence)), false);
  assert.equal(normalize_math(`~~~sh\necho $A\n~~~\nthen it costs $5`), "~~~sh\necho $A\n~~~\nthen it costs \\$5");
  assert.equal(normalize_math("~~~\n```\necho $HOME\n~~~\nafter $5"), "~~~\n```\necho $HOME\n~~~\nafter \\$5");
  const unclosed = "~~~py\nx = '$5'\n\nprint(x)";
  assert.deepEqual(normalize_blocks(unclosed), [unclosed]);
});

test("indented code blocks keep dollars and bracket delimiters exactly as written", () => {
  const text = `Run this:\n\n    echo $HOME\n    ${sed}\n    cost=$5`;
  assert.deepEqual(normalize_blocks(text), [text]);
  assert.equal(normalize_math(`    echo $HOME\n\n    echo $PATH`), `    echo $HOME\n\n    echo $PATH`);
  assert.equal(normalize_math("# Title\n\techo $HOME"), "# Title\n\techo $HOME");
  assert.equal(has_math(normalize_math("text\n\n    x = $a$")), false);
  assert.equal(normalize_math("text\n\n    x = $a$\n\nthen $b$ and $5"), "text\n\n    x = $a$\n\nthen $b$ and \\$5");
});

test("an indented line cannot interrupt a paragraph, so it is normalized as today", () => {
  assert.equal(normalize_math("it costs $5\n    and $10 more"), "it costs \\$5\n    and \\$10 more");
  assert.equal(normalize_math("> quoted $5\n    lazy $6"), "> quoted \\$5\n    lazy \\$6");
  assert.equal(normalize_math("inline \\(x\\)\n    and \\(y\\)"), "inline $x$\n    and $y$");
});

test("indented continuation lines inside list items stay prose", () => {
  assert.equal(normalize_math("- item costs $5\n\n  continued $10"), "- item costs \\$5\n\n  continued \\$10");
  assert.equal(normalize_math("1. Step one\n\n    Price $5\n\n    per \\(n\\)"), "1. Step one\n\n    Price \\$5\n\n    per $n$");
  assert.equal(normalize_math("- a\n  - nested $5\n\n    more $6"), "- a\n  - nested \\$5\n\n    more \\$6");
  assert.equal(normalize_math("10. ten\n\n    still prose $5"), "10. ten\n\n    still prose \\$5");
  assert.equal(normalize_math("- a\nlazy\n\n    after $5"), "- a\nlazy\n\n    after \\$5");
  assert.equal(normalize_math("[^1]: Note $5\n\n    more $6"), "[^1]: Note \\$5\n\n    more \\$6");
});

test("code nested in list items is detected at the item's own indentation", () => {
  assert.equal(normalize_math("- item $5\n\n      echo $HOME"), "- item \\$5\n\n      echo $HOME");
  const fenced = "1. Run:\n   ~~~bash\n   echo $HOME\n   ~~~\n2. It costs $5";
  assert.equal(normalize_math(fenced), "1. Run:\n   ~~~bash\n   echo $HOME\n   ~~~\n2. It costs \\$5");
  assert.equal(normalize_math("- ~~~\n  echo $HOME\n- then $5"), "- ~~~\n  echo $HOME\n- then \\$5");
});

test("other block structures keep normalizing the way they did", () => {
  assert.equal(normalize_math("| a | b |\n|---|---|\n| $5 | $6 |"), "| a | b |\n|---|---|\n| \\$5 | \\$6 |");
  assert.equal(normalize_math("<details>\n~~~\n\nafter $5"), "<details>\n~~~\n\nafter \\$5");
  assert.equal(normalize_math("text\n2. not a list $5\n    lazy $6"), "text\n2. not a list \\$5\n    lazy \\$6");
});

test("backtick code is handled exactly as before", () => {
  assert.equal(normalize_math("```bash\necho $HOME\n```\ncosts $5"), "```bash\necho $HOME\n```\ncosts \\$5");
  assert.equal(normalize_math("keep `$5` and `\\(x\\)`, escape $6"), "keep `$5` and `\\(x\\)`, escape \\$6");
  assert.equal(normalize_math("```py\nx = '$5'\n\nprint(x)"), "```py\nx = '$5'\n\nprint(x)");
  assert.equal(has_math("```sh\necho $A $B\n```\n\nthen $x$"), true);
});
