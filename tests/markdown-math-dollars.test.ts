import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import { normalize_math } from "../src/components/markdown-blocks.ts";

const literal = (text: string) => text.replaceAll("$", "\\$");

test("shell variables outside code stay plain text instead of becoming formulas", () => {
  for (const source of [
    '$env:INCLUDE = "$vc\\include;$sdk\\Include\\10.0.26100.0\\ucrt;$sdk\\Include\\10.0.26100.0\\um"',
    '"$dir/$(basename "$f")"',
    '"$name$($x.Count)"',
    '"$x;${env:Path}"',
    'echo "$a$b"',
    "costs $5 and $10",
  ]) {
    assert.equal(normalize_math(source), literal(source), source);
  }
});

test("real inline formulas still render, English ordinals included", () => {
  for (const source of ["Die Laufzeit ist $O(n)$.", "$x^2 + y^2$", "das $n$-te Element", "$a$ and $b$", "the $i$th row and the $n$th element", "$n$über", "the $k$-th, $1$st and $2$nd"]) {
    assert.equal(normalize_math(source), source, source);
  }
});

test("a rejected closer turns its opener into a dollar sign instead of reaching a later formula", () => {
  assert.equal(normalize_math('Set $env:X = "$vc\\bin" and the cost is $x^2$.'), 'Set \\$env:X = "\\$vc\\bin" and the cost is $x^2$.');
  assert.equal(normalize_math("das $n$te Element"), "das \\$n\\$te Element");
});

test("the Markdown parser shows the PowerShell line as written and still finds the formula after it", () => {
  const source = '$env:INCLUDE = "$vc\\include;$sdk\\Include\\ucrt" costs $O(n)$';
  const html = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkMath], children: normalize_math(source) }));
  assert.ok(html.includes('$env:INCLUDE = &quot;$vc\\include;$sdk\\Include\\ucrt&quot; costs'), html);
  assert.equal((html.match(/math-inline/g) ?? []).length, 1, html);
});
