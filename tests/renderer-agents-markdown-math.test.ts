import assert from "node:assert/strict";
import { test } from "node:test";
import { has_math, normalize_math } from "../src/components/markdown-blocks.ts";

test("math detection asks for the math module only when math can render", () => {
  assert.equal(has_math("the area is $a^2$"), true);
  assert.equal(has_math("$$\na = b\n$$"), true);
  assert.equal(has_math(normalize_math("inline \\(x\\) here")), true);
  assert.equal(has_math(normalize_math("\\[x = 1\\]")), true);
  assert.equal(has_math("it costs $5"), false);
  assert.equal(has_math("plain text"), false);
});

test("dollars inside code never trigger the math module", () => {
  assert.equal(has_math("run `echo $HOME and $PATH`"), false);
  assert.equal(has_math("```powershell\n$env:PATH = $env:PATH + ';x'\n```"), false);
  assert.equal(has_math("```sh\necho $A $B\n```\n\nthen $x$"), true);
});

test("a formula alone on its line becomes display math, inline and code formulas stay as they are", () => {
  assert.equal(normalize_math("The sum:\n\n$$\\sum_{n=1}^{\\infty} \\frac{1}{n^2}$$\n\nnext"), "The sum:\n\n$$\n\\sum_{n=1}^{\\infty} \\frac{1}{n^2}\n$$\n\nnext");
  assert.equal(normalize_math("\\[x = 1\\]"), "$$\nx = 1\n$$");
  assert.equal(normalize_math("   $$ a + b $$  "), "   $$\n   a + b\n   $$");
  assert.equal(normalize_math("so $$x$$ inline"), "so $$x$$ inline");
  assert.equal(normalize_math("`code` $$x$$"), "`code` $$x$$");
  assert.equal(normalize_math("$$x$$ `code`"), "$$x$$ `code`");
  assert.equal(normalize_math("$$\na = b\n$$"), "$$\na = b\n$$");
  assert.equal(normalize_math("```\n$$x$$\n```"), "```\n$$x$$\n```");
});
